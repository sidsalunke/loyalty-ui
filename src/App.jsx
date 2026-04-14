import EnrollmentForm from './components/EnrollmentForm'
import './App.css'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-icon">★</span>
            <span className="brand-name">LoyaltyPlus</span>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="hero">
          <h1>Join Our Loyalty Programme</h1>
          <p>Sign up today and start earning rewards as a Blue member.</p>
        </div>
        <EnrollmentForm />
      </main>

      <footer className="app-footer">
        <p>© 2026 LoyaltyPlus. All rights reserved.</p>
      </footer>
    </div>
  )
}

export default App
