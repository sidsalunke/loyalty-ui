import { useState, useEffect, useRef } from 'react'
import { submitEnrolment, pollEnrolmentStatus } from '../services/enrollmentApi'
import './EnrollmentForm.css'

const COUNTRIES = [
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'SG', name: 'Singapore' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'IN', name: 'India' },
  { code: 'JP', name: 'Japan' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' }
]

const INITIAL_FORM   = { firstName: '', lastName: '', dateOfBirth: '', country: '' }
const INITIAL_ERRORS = { firstName: '', lastName: '', dateOfBirth: '', country: '' }

function validate(fields) {
  const errors = { ...INITIAL_ERRORS }
  let valid = true

  if (!fields.firstName.trim()) {
    errors.firstName = 'First name is required.'; valid = false
  } else if (fields.firstName.trim().length < 2) {
    errors.firstName = 'First name must be at least 2 characters.'; valid = false
  }

  if (!fields.lastName.trim()) {
    errors.lastName = 'Last name is required.'; valid = false
  } else if (fields.lastName.trim().length < 2) {
    errors.lastName = 'Last name must be at least 2 characters.'; valid = false
  }

  if (!fields.dateOfBirth) {
    errors.dateOfBirth = 'Date of birth is required.'; valid = false
  } else {
    const dob = new Date(fields.dateOfBirth)
    const today = new Date()
    const age = today.getFullYear() - dob.getFullYear()
    if (isNaN(dob.getTime())) {
      errors.dateOfBirth = 'Please enter a valid date.'; valid = false
    } else if (dob >= today) {
      errors.dateOfBirth = 'Date of birth must be in the past.'; valid = false
    } else if (age < 18) {
      errors.dateOfBirth = 'You must be at least 18 years old to enrol.'; valid = false
    }
  }

  if (!fields.country) { errors.country = 'Please select a country.'; valid = false }

  return { errors, valid }
}

const Status = { IDLE: 'IDLE', LOADING: 'LOADING', PROCESSING: 'PROCESSING', SUCCESS: 'SUCCESS', ERROR: 'ERROR' }

export default function EnrollmentForm() {
  const [form, setForm]               = useState(INITIAL_FORM)
  const [fieldErrors, setFieldErrors] = useState(INITIAL_ERRORS)
  const [status, setStatus]           = useState(Status.IDLE)
  const [apiError, setApiError]       = useState('')
  const [correlationId, setCorrelationId] = useState('')
  const [membershipNumber, setMembershipNumber] = useState('')
  const [tier, setTier]               = useState('')

  // Keep a ref to cancel polling if the component unmounts mid-poll
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    return () => { cancelledRef.current = true }
  }, [])

  // ── Polling effect — runs whenever we enter PROCESSING state ──────────────
  useEffect(() => {
    if (status !== Status.PROCESSING || !correlationId) return

    let cancelled = false

    async function poll() {
      try {
        const result = await pollEnrolmentStatus(correlationId)
        if (cancelled || cancelledRef.current) return

        if (result.status === 'COMPLETED') {
          setMembershipNumber(result.membershipNumber)
          setTier(result.tier)
          setStatus(Status.SUCCESS)
        } else {
          setApiError(result.errorMessage || 'Enrolment failed. Please contact support.')
          setStatus(Status.ERROR)
        }
      } catch (err) {
        if (cancelled || cancelledRef.current) return
        setApiError(err.message)
        setStatus(Status.ERROR)
      }
    }

    poll()
    return () => { cancelled = true }
  }, [status, correlationId])

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    if (fieldErrors[name]) setFieldErrors(prev => ({ ...prev, [name]: '' }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setApiError('')

    const { errors, valid } = validate(form)
    if (!valid) { setFieldErrors(errors); return }

    setStatus(Status.LOADING)
    try {
      const result = await submitEnrolment({
        firstName:   form.firstName.trim(),
        lastName:    form.lastName.trim(),
        dateOfBirth: form.dateOfBirth,
        country:     form.country
      })
      setCorrelationId(result.correlationId)
      setStatus(Status.PROCESSING)   // triggers the polling effect
    } catch (err) {
      setApiError(err.message)
      setStatus(Status.ERROR)
    }
  }

  function handleReset() {
    setForm(INITIAL_FORM)
    setFieldErrors(INITIAL_ERRORS)
    setApiError('')
    setCorrelationId('')
    setMembershipNumber('')
    setTier('')
    setStatus(Status.IDLE)
  }

  // ── PROCESSING — waiting for Solace event ─────────────────────────────────
  if (status === Status.PROCESSING) {
    return (
      <div className="card processing-card" data-testid="processing-panel">
        <div className="processing-spinner" aria-label="Loading" />
        <h2>Assigning your membership…</h2>
        <p className="processing-body">Your enrolment has been accepted. We're waiting for your membership number to be assigned.</p>
        <p className="correlation-id">Reference: <code>{correlationId}</code></p>
      </div>
    )
  }

  // ── SUCCESS — Solace event received ───────────────────────────────────────
  if (status === Status.SUCCESS) {
    return (
      <div className="card success-card" data-testid="success-panel">
        <div className="success-icon">✓</div>
        <h2>Welcome to LoyaltyPlus!</h2>
        <p className="success-body">
          You are now a <strong className="tier-badge">{tier || 'Blue'} Member</strong>.
        </p>
        <div className="membership-number-box" data-testid="membership-number">
          <span className="membership-label">Your membership number</span>
          <span className="membership-value">{membershipNumber}</span>
        </div>
        <p className="correlation-id">Reference: <code>{correlationId}</code></p>
        <button className="btn btn-secondary" onClick={handleReset}>
          Enrol another member
        </button>
      </div>
    )
  }

  // ── FORM (IDLE | LOADING | ERROR) ─────────────────────────────────────────
  const submitting = status === Status.LOADING

  return (
    <div className="card" data-testid="enrollment-form-card">
      <h2 className="form-title">Member Enrolment</h2>
      <p className="form-subtitle">Fill in your details below to join as a Blue member.</p>

      {status === Status.ERROR && (
        <div className="alert alert-error" role="alert" data-testid="api-error">
          <strong>Enrolment failed.</strong> {apiError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate data-testid="enrollment-form">
        <div className="form-row">
          <div className={`form-group ${fieldErrors.firstName ? 'has-error' : ''}`}>
            <label htmlFor="firstName">First Name</label>
            <input id="firstName" name="firstName" type="text" autoComplete="given-name"
              placeholder="e.g. Jane" value={form.firstName} onChange={handleChange}
              disabled={submitting}
              aria-describedby={fieldErrors.firstName ? 'firstName-error' : undefined} />
            {fieldErrors.firstName && (
              <span id="firstName-error" className="field-error" role="alert">{fieldErrors.firstName}</span>
            )}
          </div>

          <div className={`form-group ${fieldErrors.lastName ? 'has-error' : ''}`}>
            <label htmlFor="lastName">Last Name</label>
            <input id="lastName" name="lastName" type="text" autoComplete="family-name"
              placeholder="e.g. Smith" value={form.lastName} onChange={handleChange}
              disabled={submitting}
              aria-describedby={fieldErrors.lastName ? 'lastName-error' : undefined} />
            {fieldErrors.lastName && (
              <span id="lastName-error" className="field-error" role="alert">{fieldErrors.lastName}</span>
            )}
          </div>
        </div>

        <div className={`form-group ${fieldErrors.dateOfBirth ? 'has-error' : ''}`}>
          <label htmlFor="dateOfBirth">Date of Birth</label>
          <input id="dateOfBirth" name="dateOfBirth" type="date" autoComplete="bday"
            value={form.dateOfBirth} onChange={handleChange} disabled={submitting}
            max={new Date().toISOString().split('T')[0]}
            aria-describedby={fieldErrors.dateOfBirth ? 'dateOfBirth-error' : undefined} />
          {fieldErrors.dateOfBirth && (
            <span id="dateOfBirth-error" className="field-error" role="alert">{fieldErrors.dateOfBirth}</span>
          )}
        </div>

        <div className={`form-group ${fieldErrors.country ? 'has-error' : ''}`}>
          <label htmlFor="country">Country</label>
          <select id="country" name="country" value={form.country} onChange={handleChange}
            disabled={submitting}
            aria-describedby={fieldErrors.country ? 'country-error' : undefined}>
            <option value="">— Select your country —</option>
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          {fieldErrors.country && (
            <span id="country-error" className="field-error" role="alert">{fieldErrors.country}</span>
          )}
        </div>

        <button type="submit" className="btn btn-primary" disabled={submitting} data-testid="submit-btn">
          {submitting ? (<><span className="spinner" aria-hidden="true" />Submitting…</>) : 'Enrol Now'}
        </button>
      </form>
    </div>
  )
}
