/**
 * FE CI Tests — fe-ci Playwright project
 *
 * The backend is fully mocked using Playwright's route interception.
 * No real services need to be running.
 *
 * Scenarios covered:
 *   ✓ Form renders with all required fields
 *   ✓ Client-side validation errors (empty, underage, short name)
 *   ✓ Field error clears on user input
 *   ✓ Happy path — 200 success
 *   ✓ Success panel shows tier badge and correlation ID
 *   ✓ Can reset and enrol another member
 *   ✓ Submit button disabled while request is in-flight
 *   ✓ Response latency — loading spinner visible during slow response
 *   ✓ Network failure — BE completely unreachable
 *   ✓ 400 Bad Request
 *   ✓ 422 Unprocessable Entity
 *   ✓ 500 Internal Server Error
 */

import { test, expect } from '@playwright/test'

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fillValidForm(page) {
  await page.fill('#firstName', 'Jane')
  await page.fill('#lastName', 'Smith')
  await page.fill('#dateOfBirth', '1990-06-15')
  await page.selectOption('#country', 'AU')
}

function mockSuccess(page, correlationId = 'test-corr-id-001') {
  return page.route('/api/v1/enroll', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Enrollment request accepted', correlationId })
    })
  )
}

// ── Form rendering ────────────────────────────────────────────────────────────

test.describe('Form rendering', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/') })

  test('renders all required fields and submit button', async ({ page }) => {
    await expect(page.getByTestId('enrollment-form-card')).toBeVisible()
    await expect(page.locator('#firstName')).toBeVisible()
    await expect(page.locator('#lastName')).toBeVisible()
    await expect(page.locator('#dateOfBirth')).toBeVisible()
    await expect(page.locator('#country')).toBeVisible()
    await expect(page.getByTestId('submit-btn')).toBeVisible()
    await expect(page.getByTestId('submit-btn')).toBeEnabled()
  })

  test('shows tier information in hero text', async ({ page }) => {
    await expect(page.locator('.hero')).toContainText('Blue member')
  })
})

// ── Client-side validation ────────────────────────────────────────────────────

test.describe('Client-side validation', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/') })

  test('shows all field errors when submitting empty form', async ({ page }) => {
    await page.getByTestId('submit-btn').click()

    await expect(page.locator('#firstName-error')).toHaveText('First name is required.')
    await expect(page.locator('#lastName-error')).toHaveText('Last name is required.')
    await expect(page.locator('#dateOfBirth-error')).toHaveText('Date of birth is required.')
    await expect(page.locator('#country-error')).toHaveText('Please select a country.')
  })

  test('shows error when first name is too short', async ({ page }) => {
    await page.fill('#firstName', 'A')
    await page.getByTestId('submit-btn').click()
    await expect(page.locator('#firstName-error')).toContainText('at least 2 characters')
  })

  test('shows error for underage date of birth', async ({ page }) => {
    const dob = new Date()
    dob.setFullYear(dob.getFullYear() - 10)
    await page.fill('#firstName', 'Junior')
    await page.fill('#lastName', 'Doe')
    await page.fill('#dateOfBirth', dob.toISOString().split('T')[0])
    await page.selectOption('#country', 'AU')

    await page.getByTestId('submit-btn').click()
    await expect(page.locator('#dateOfBirth-error')).toContainText('at least 18 years old')
  })

  test('shows error for future date of birth', async ({ page }) => {
    const future = new Date()
    future.setFullYear(future.getFullYear() + 1)
    await page.fill('#firstName', 'Future')
    await page.fill('#lastName', 'Person')
    await page.fill('#dateOfBirth', future.toISOString().split('T')[0])
    await page.selectOption('#country', 'AU')

    await page.getByTestId('submit-btn').click()
    await expect(page.locator('#dateOfBirth-error')).toContainText('in the past')
  })

  test('clears field error as soon as user starts typing', async ({ page }) => {
    await page.getByTestId('submit-btn').click()
    await expect(page.locator('#firstName-error')).toBeVisible()

    await page.fill('#firstName', 'J')
    await expect(page.locator('#firstName-error')).toBeHidden()
  })

  test('does not call the API when form is invalid', async ({ page }) => {
    let apiCalled = false
    await page.route('/api/v1/enroll', () => { apiCalled = true })

    await page.getByTestId('submit-btn').click()
    await expect(page.locator('#firstName-error')).toBeVisible()
    expect(apiCalled).toBe(false)
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

test.describe('Happy path', () => {
  test('shows success panel with Blue Member badge on 200', async ({ page }) => {
    await mockSuccess(page, 'happy-path-corr-id')
    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()

    await expect(page.getByTestId('success-panel')).toBeVisible()
    await expect(page.locator('.tier-badge')).toHaveText('Blue Member')
    await expect(page.locator('.correlation-id code')).toHaveText('happy-path-corr-id')
  })

  test('can enrol another member after success', async ({ page }) => {
    await mockSuccess(page)
    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()

    await expect(page.getByTestId('success-panel')).toBeVisible()
    await page.getByText('Enrol another member').click()

    await expect(page.getByTestId('enrollment-form-card')).toBeVisible()
    await expect(page.locator('#firstName')).toHaveValue('')
    await expect(page.locator('#country')).toHaveValue('')
  })
})

// ── Loading / in-flight state ─────────────────────────────────────────────────

test.describe('Loading state', () => {
  test('submit button is disabled while request is in-flight', async ({ page }) => {
    await page.route('/api/v1/enroll', async route => {
      await new Promise(r => setTimeout(r, 400))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'OK', correlationId: 'latency-test' })
      })
    })

    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()

    // Button should be disabled immediately after click
    await expect(page.getByTestId('submit-btn')).toBeDisabled()
    // Spinner should be visible
    await expect(page.locator('.spinner')).toBeVisible()
    // All inputs should be disabled
    await expect(page.locator('#firstName')).toBeDisabled()
    await expect(page.locator('#country')).toBeDisabled()

    // Eventually resolves to success
    await expect(page.getByTestId('success-panel')).toBeVisible()
  })

  test('slow response (2 s latency) — spinner stays visible throughout', async ({ page }) => {
    await page.route('/api/v1/enroll', async route => {
      await new Promise(r => setTimeout(r, 2000))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'OK', correlationId: 'slow-corr' })
      })
    })

    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()

    // Spinner should still be visible after 1 second
    await page.waitForTimeout(1000)
    await expect(page.locator('.spinner')).toBeVisible()
    await expect(page.getByTestId('submit-btn')).toBeDisabled()

    // Eventually completes
    await expect(page.getByTestId('success-panel')).toBeVisible({ timeout: 4000 })
  })
})

// ── Network failure ───────────────────────────────────────────────────────────

test.describe('Network failure — BE completely unreachable', () => {
  test('shows user-friendly error when the network request is aborted', async ({ page }) => {
    await page.route('/api/v1/enroll', route => route.abort('failed'))

    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()

    await expect(page.getByTestId('api-error')).toBeVisible()
    await expect(page.getByTestId('api-error')).toContainText('Could not reach the service')
    // Form should still be visible so user can retry
    await expect(page.getByTestId('enrollment-form-card')).toBeVisible()
  })

  test('shows error when connection is reset mid-request', async ({ page }) => {
    await page.route('/api/v1/enroll', route => route.abort('connectionreset'))

    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()

    await expect(page.getByTestId('api-error')).toBeVisible()
    await expect(page.getByTestId('api-error')).toContainText('Could not reach the service')
  })

  test('submit button is re-enabled after network failure so user can retry', async ({ page }) => {
    await page.route('/api/v1/enroll', route => route.abort('failed'))

    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()

    await expect(page.getByTestId('api-error')).toBeVisible()
    // Button should be re-enabled (status goes back to ERROR, not LOADING)
    await expect(page.getByTestId('submit-btn')).toBeEnabled()
  })
})

// ── HTTP error responses ──────────────────────────────────────────────────────

test.describe('HTTP error responses from BE', () => {
  async function submitAndExpectError(page, status, body, expectedText) {
    await page.route('/api/v1/enroll', route =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    )
    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()

    await expect(page.getByTestId('api-error')).toBeVisible()
    await expect(page.getByTestId('api-error')).toContainText(expectedText)
    await expect(page.getByTestId('enrollment-form-card')).toBeVisible()
  }

  test('400 Bad Request — shows vendor error message', async ({ page }) => {
    await submitAndExpectError(
      page, 400,
      { message: 'Invalid date of birth format.' },
      'Invalid date of birth format.'
    )
  })

  test('422 Unprocessable Entity — shows duplicate member message', async ({ page }) => {
    await submitAndExpectError(
      page, 422,
      { message: 'Member already exists with the provided details.' },
      'Member already exists'
    )
  })

  test('500 Internal Server Error — shows generic service error', async ({ page }) => {
    await submitAndExpectError(
      page, 500,
      { message: 'Vendor service is temporarily unavailable. Please try again later.' },
      'temporarily unavailable'
    )
  })

  test('502 Bad Gateway — BE cannot reach vendor', async ({ page }) => {
    await submitAndExpectError(
      page, 502,
      { message: 'Could not connect to the vendor service. Please try again later.' },
      'Could not connect to the vendor service'
    )
  })

  test('error panel disappears when user retries successfully', async ({ page }) => {
    // First call fails
    let callCount = 0
    await page.route('/api/v1/enroll', route => {
      callCount++
      if (callCount === 1) {
        route.fulfill({ status: 500, contentType: 'application/json',
          body: JSON.stringify({ message: 'Temporary error' }) })
      } else {
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ message: 'OK', correlationId: 'retry-success' }) })
      }
    })

    await page.goto('/')
    await fillValidForm(page)
    await page.getByTestId('submit-btn').click()
    await expect(page.getByTestId('api-error')).toBeVisible()

    // Retry — should succeed this time
    await page.getByTestId('submit-btn').click()
    await expect(page.getByTestId('success-panel')).toBeVisible()
    await expect(page.getByTestId('api-error')).toBeHidden()
  })
})
