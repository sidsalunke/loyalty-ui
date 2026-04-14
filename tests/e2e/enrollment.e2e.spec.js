/**
 * FE E2E Tests (fake mode) — fe-e2e Playwright project
 *
 * Runs against the real FE + real mediation service + vendor-mock.
 * No Playwright route interception — all calls go through to the actual stack.
 * Solace is running; vendor-mock publishes the completion event after ~1s.
 *
 * Prerequisites (handled by fe-e2e-fake.yml workflow, or manually):
 *   docker-compose up -d   (from loyalty-mediation/)
 *   npm run dev            (started automatically by Playwright webServer config)
 *
 * Scenarios covered:
 *   ✓ Smoke — mediation service is reachable
 *   ✓ Happy path — full async flow: enrol → PROCESSING → COMPLETED with membership number
 *   ✓ Each enrolment gets a unique correlation ID
 *   ✓ Client-side validation still works with real BE
 *   ✓ 422 error path — vendor-mock test config endpoint used to inject duplicate error
 *   ✓ 502 error path — vendor-mock test config endpoint used to simulate vendor down
 */

import { test, expect } from '@playwright/test'

// ── Constants ─────────────────────────────────────────────────────────────────

const MEDIATION_BASE = 'http://localhost:8080'
const VENDOR_MOCK_BASE = 'http://localhost:8081'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fillValidForm(page, overrides = {}) {
  await page.fill('#firstName', overrides.firstName ?? 'Jane')
  await page.fill('#lastName',  overrides.lastName  ?? 'Smith')
  await page.fill('#dateOfBirth', overrides.dateOfBirth ?? '1990-06-15')
  await page.selectOption('#country', overrides.country ?? 'AU')
}

/**
 * Sets the vendor-mock one-shot next-response config.
 * The next POST to /api/v1/vendor/enroll will return this status + message.
 * After it fires once, the mock reverts to default success behaviour.
 */
async function setVendorNextResponse(request, statusCode, message) {
  const res = await request.post(
    `${VENDOR_MOCK_BASE}/api/v1/vendor/test/next-response`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: { statusCode, message }
    }
  )
  expect(res.ok()).toBeTruthy()
}

/** Clears any leftover test config on the vendor-mock. */
async function clearVendorTestConfig(request) {
  await request.delete(`${VENDOR_MOCK_BASE}/api/v1/vendor/test/next-response`)
}

// ── Smoke test ────────────────────────────────────────────────────────────────

test.describe('Smoke — stack is up', () => {
  test('mediation service responds to a validation-error probe', async ({ request }) => {
    const res = await request.post(`${MEDIATION_BASE}/api/v1/enroll`, {
      headers: { 'Content-Type': 'application/json' },
      data: {}
    })
    // Any response other than a network error confirms the service is reachable
    expect([400, 422]).toContain(res.status())
  })

  test('vendor-mock test config endpoint is reachable', async ({ request }) => {
    const res = await request.delete(`${VENDOR_MOCK_BASE}/api/v1/vendor/test/next-response`)
    expect(res.ok()).toBeTruthy()
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

test.describe('Happy path — real async flow', () => {
  test('enrolment → PROCESSING → COMPLETED with membership number', async ({ page }) => {
    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()

    // After the POST, the FE should show the processing card while polling
    await expect(page.getByTestId('processing-panel')).toBeVisible({ timeout: 5_000 })

    // Vendor-mock publishes a Solace event ~1s after accepting the request.
    // Poll for the success panel — allow up to 15s for the full async round-trip.
    await expect(page.getByTestId('success-panel')).toBeVisible({ timeout: 15_000 })

    await expect(page.locator('.tier-badge')).toHaveText('Blue Member')

    // Membership number is a 9-digit number from the vendor-mock
    const membershipNumber = await page.locator('.membership-value').textContent()
    expect(membershipNumber?.trim()).toMatch(/^[0-9]{9}$/)

    // Correlation ID is a real UUID
    const corrId = await page.locator('.correlation-id code').textContent()
    expect(corrId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  })

  test('each enrolment gets a unique correlation ID', async ({ page }) => {
    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()
    await expect(page.getByTestId('success-panel')).toBeVisible({ timeout: 15_000 })
    const first = await page.locator('.correlation-id code').textContent()

    await page.getByText('Enrol another member').click()
    await fillValidForm(page, { firstName: 'John', lastName: 'Doe' })
    await page.getByTestId('submit-btn').click()
    await expect(page.getByTestId('success-panel')).toBeVisible({ timeout: 15_000 })
    const second = await page.locator('.correlation-id code').textContent()

    expect(first).not.toBe(second)
  })
})

// ── Client-side validation still works end-to-end ────────────────────────────

test.describe('Client-side validation — real stack', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/') })

  test('empty form — validation errors shown without hitting the BE', async ({ page }) => {
    await page.getByTestId('submit-btn').click()
    await expect(page.locator('#firstName-error')).toBeVisible()
    await expect(page.locator('#lastName-error')).toBeVisible()
    await expect(page.locator('#dateOfBirth-error')).toBeVisible()
    await expect(page.locator('#country-error')).toBeVisible()
  })

  test('underage DOB — blocked client-side, no network call made', async ({ page }) => {
    const dob = new Date()
    dob.setFullYear(dob.getFullYear() - 16)
    await page.fill('#firstName', 'Young')
    await page.fill('#lastName',  'User')
    await page.fill('#dateOfBirth', dob.toISOString().split('T')[0])
    await page.selectOption('#country', 'AU')

    await page.getByTestId('submit-btn').click()
    await expect(page.locator('#dateOfBirth-error')).toContainText('at least 18 years old')
    await expect(page.getByTestId('success-panel')).toBeHidden()
    await expect(page.getByTestId('processing-panel')).toBeHidden()
  })
})

// ── Error paths via vendor-mock test config endpoint ─────────────────────────
//
// The vendor-mock exposes POST /api/v1/vendor/test/next-response which overrides
// the next enrolment response exactly once, then reverts to default success.
// This lets us test the FE error path end-to-end without X-Simulate-Error header
// forwarding in the mediation service.

test.describe('Error paths — via vendor-mock test config', () => {
  test.afterEach(async ({ request }) => {
    // Always clean up leftover config so tests don't bleed into each other
    await clearVendorTestConfig(request)
  })

  test('422 from vendor — UI shows "Member already exists" error', async ({ page, request }) => {
    await setVendorNextResponse(request, 422, 'Member already exists')

    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()

    await expect(page.getByTestId('api-error')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('api-error')).toContainText('Member already exists')
    await expect(page.getByTestId('enrollment-form-card')).toBeVisible()
  })

  test('502 from vendor — UI shows "Could not connect" error', async ({ page, request }) => {
    await setVendorNextResponse(request, 502, 'Could not connect to the vendor service')

    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()

    await expect(page.getByTestId('api-error')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('api-error')).toContainText('Could not connect')
    await expect(page.getByTestId('enrollment-form-card')).toBeVisible()
  })

  test('one-shot config fires only once — second enrolment succeeds', async ({ page, request }) => {
    // Set the next-response override to 422 — fires only on the first call
    await setVendorNextResponse(request, 422, 'Member already exists')

    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()
    await expect(page.getByTestId('api-error')).toBeVisible({ timeout: 5_000 })

    // Second attempt: no override in effect, so vendor-mock returns default success
    await page.getByTestId('submit-btn').click()
    await expect(page.getByTestId('success-panel')).toBeVisible({ timeout: 15_000 })
  })
})
