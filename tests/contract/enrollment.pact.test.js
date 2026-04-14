/**
 * Pact Consumer Contract Tests — loyalty-ui → loyalty-mediation
 *
 * What this does:
 *   Defines the API contract that the FE expects from the mediation service.
 *   Pact spins up a local mock server, the test makes real HTTP calls to it,
 *   and the interactions are recorded to pacts/loyalty-ui-loyalty-mediation.json.
 *
 * That pact file is committed to this repo and used by the BE CI to verify
 * the mediation service actually fulfils every interaction defined here.
 *
 * Run: npm run test:contract
 */

import path from 'path'
import { fileURLToPath } from 'url'
import { PactV3, MatchersV3 } from '@pact-foundation/pact'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const { like, regex, fromProviderState } = MatchersV3

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Provider definition ───────────────────────────────────────────────────────

const provider = new PactV3({
  consumer: 'loyalty-ui',
  provider: 'loyalty-mediation',
  dir: path.resolve(__dirname, '../../pacts'),
  logLevel: 'warn'
})

// ── Helper — call the Pact mock server directly (no browser / Vite proxy) ────

async function post(baseUrl, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function get(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`)
  return { status: res.status, body: await res.json().catch(() => null) }
}

const validEnrolmentBody = {
  firstName:   'Jane',
  lastName:    'Smith',
  dateOfBirth: '1990-06-15',
  country:     'AU'
}

// ── Interactions ──────────────────────────────────────────────────────────────

describe('loyalty-ui → loyalty-mediation contract', () => {

  // ── POST /api/v1/enroll ────────────────────────────────────────────────────

  describe('POST /api/v1/enroll', () => {

    it('returns 200 with message and correlationId for a valid enrolment', async () => {
      await provider
        .given('the vendor system is available')
        .uponReceiving('a valid enrolment request')
        .withRequest({
          method: 'POST',
          path: '/api/v1/enroll',
          headers: { 'Content-Type': 'application/json' },
          body: {
            firstName:   like('Jane'),
            lastName:    like('Smith'),
            dateOfBirth: like('1990-06-15'),
            country:     like('AU')
          }
        })
        .willRespondWith({
          status: 200,
          body: {
            message:       like('Enrollment request accepted'),
            correlationId: regex(
              '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
              'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
            )
          }
        })
        .executeTest(async (mockServer) => {
          const { status, body } = await post(mockServer.url, '/api/v1/enroll', validEnrolmentBody)
          expect(status).toBe(200)
          expect(body.message).toBeTruthy()
          expect(body.correlationId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
          )
        })
    })

    it('returns 400 when required fields are missing', async () => {
      await provider
        .given('the vendor system is available')
        .uponReceiving('an enrolment request with missing fields')
        .withRequest({
          method: 'POST',
          path: '/api/v1/enroll',
          headers: { 'Content-Type': 'application/json' },
          body: {}
        })
        .willRespondWith({
          status: 400,
          body: {
            status:  like(400),
            message: like('Validation failed')
          }
        })
        .executeTest(async (mockServer) => {
          const { status, body } = await post(mockServer.url, '/api/v1/enroll', {})
          expect(status).toBe(400)
          expect(body.message).toBeTruthy()
        })
    })

    it('returns 422 when vendor rejects the request as a duplicate', async () => {
      await provider
        .given('the member already exists in the vendor system')
        .uponReceiving('an enrolment request for an existing member')
        .withRequest({
          method: 'POST',
          path: '/api/v1/enroll',
          headers: { 'Content-Type': 'application/json' },
          body: {
            firstName:   like('Jane'),
            lastName:    like('Smith'),
            dateOfBirth: like('1990-06-15'),
            country:     like('AU')
          }
        })
        .willRespondWith({
          status: 422,
          body: {
            status:  like(422),
            message: like('Member already exists')
          }
        })
        .executeTest(async (mockServer) => {
          const { status, body } = await post(mockServer.url, '/api/v1/enroll', validEnrolmentBody)
          expect(status).toBe(422)
          expect(body.message).toBeTruthy()
        })
    })

    it('returns 502 when the vendor service is unavailable', async () => {
      await provider
        .given('the vendor system is unavailable')
        .uponReceiving('an enrolment request when vendor is down')
        .withRequest({
          method: 'POST',
          path: '/api/v1/enroll',
          headers: { 'Content-Type': 'application/json' },
          body: {
            firstName:   like('Jane'),
            lastName:    like('Smith'),
            dateOfBirth: like('1990-06-15'),
            country:     like('AU')
          }
        })
        .willRespondWith({
          status: 502,
          body: {
            status:  like(502),
            message: like('Could not connect to the vendor service')
          }
        })
        .executeTest(async (mockServer) => {
          const { status, body } = await post(mockServer.url, '/api/v1/enroll', validEnrolmentBody)
          expect(status).toBe(502)
          expect(body.message).toBeTruthy()
        })
    })
  })

  // ── GET /api/v1/enroll/{correlationId}/status ─────────────────────────────

  describe('GET /api/v1/enroll/{correlationId}/status', () => {

    it('returns COMPLETED status with membershipNumber when enrolment is done', async () => {
      await provider
        .given('an enrolment exists with correlationId completed-corr-id and status COMPLETED')
        .uponReceiving('a status poll for a completed enrolment')
        .withRequest({
          method: 'GET',
          path: '/api/v1/enroll/completed-corr-id/status'
        })
        .willRespondWith({
          status: 200,
          body: {
            correlationId:    like('completed-corr-id'),
            status:           'COMPLETED',
            membershipNumber: regex('[0-9]{9}', '123456789'),
            tier:             like('BLUE')
          }
        })
        .executeTest(async (mockServer) => {
          const { status, body } = await get(mockServer.url, '/api/v1/enroll/completed-corr-id/status')
          expect(status).toBe(200)
          expect(body.status).toBe('COMPLETED')
          expect(body.membershipNumber).toMatch(/^[0-9]{9}$/)
          expect(body.tier).toBeTruthy()
        })
    })

    it('returns PENDING status while waiting for the vendor event', async () => {
      await provider
        .given('an enrolment exists with correlationId pending-corr-id and status PENDING')
        .uponReceiving('a status poll for a pending enrolment')
        .withRequest({
          method: 'GET',
          path: '/api/v1/enroll/pending-corr-id/status'
        })
        .willRespondWith({
          status: 200,
          body: {
            correlationId: like('pending-corr-id'),
            status:        'PENDING'
          }
        })
        .executeTest(async (mockServer) => {
          const { status, body } = await get(mockServer.url, '/api/v1/enroll/pending-corr-id/status')
          expect(status).toBe(200)
          expect(body.status).toBe('PENDING')
          expect(body.membershipNumber).toBeUndefined()
        })
    })

    it('returns 404 for an unknown correlationId', async () => {
      await provider
        .given('no enrolment exists for correlationId unknown-corr-id')
        .uponReceiving('a status poll for an unknown correlationId')
        .withRequest({
          method: 'GET',
          path: '/api/v1/enroll/unknown-corr-id/status'
        })
        .willRespondWith({ status: 404 })
        .executeTest(async (mockServer) => {
          const { status } = await get(mockServer.url, '/api/v1/enroll/unknown-corr-id/status')
          expect(status).toBe(404)
        })
    })
  })
})
