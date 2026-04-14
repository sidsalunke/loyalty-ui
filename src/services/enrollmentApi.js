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
    // fetch() itself threw — network down, DNS failure, CORS pre-flight blocked, etc.
    const err = new Error(
      'Could not reach the service. Please check your connection and try again.'
    )
    err.status = 0
    throw err
  }

  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message =
      body.message ||
      body.error ||
      `Unexpected error (HTTP ${response.status}). Please try again.`
    const err = new Error(message)
    err.status = response.status
    throw err
  }

  return body
}
