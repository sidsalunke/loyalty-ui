const BASE_URL = '/api/v1'

/**
 * Submit a membership enrolment request to the mediation layer.
 *
 * @param {Object} data - { firstName, lastName, dateOfBirth, country }
 * @returns {Promise<{ message: string, correlationId: string }>}
 * @throws {Error} with a user-friendly message on network failure or 4xx/5xx
 */
export async function submitEnrolment(data) {
  let response

  try {
    response = await fetch(`${BASE_URL}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
  } catch {
    const err = new Error(
      'Could not reach the service. Please check your connection and try again.'
    )
    err.status = 0
    throw err
  }

  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message =
      body.message || body.error || `Unexpected error (HTTP ${response.status}). Please try again.`
    const err = new Error(message)
    err.status = response.status
    throw err
  }

  return body
}

/**
 * Poll the enrolment status endpoint until the status is COMPLETED or FAILED.
 *
 * @param {string} correlationId
 * @param {Object} options
 * @param {number} options.intervalMs    - polling interval in ms (default 1500)
 * @param {number} options.maxAttempts   - give up after this many attempts (default 20)
 * @returns {Promise<{ correlationId, status, membershipNumber, tier, errorMessage }>}
 * @throws {Error} on network failure or if the status never resolves within maxAttempts
 */
export async function pollEnrolmentStatus(correlationId, { intervalMs = 1500, maxAttempts = 20 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(intervalMs)

    let response
    try {
      response = await fetch(`${BASE_URL}/enroll/${correlationId}/status`)
    } catch {
      throw new Error('Lost connection while waiting for membership number. Please check your enrolment status later.')
    }

    if (response.status === 404) {
      throw new Error('Enrolment record not found. Please contact support.')
    }

    if (!response.ok) {
      throw new Error(`Status check failed (HTTP ${response.status}). Please try again.`)
    }

    const data = await response.json()

    if (data.status === 'COMPLETED' || data.status === 'FAILED') {
      return data
    }

    // Still PENDING — continue polling
  }

  throw new Error('Your membership is still being processed. Please check back shortly.')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
