import App from './App.jsx'
import AuthGate from './components/AuthGate.jsx'
import useAuth from './hooks/useAuth.js'

export default function Root() {
  const auth = useAuth()
  // App (and every data hook inside it) mounts only once authenticated,
  // so the initial load never fires a burst of 401s.
  return (
    <AuthGate auth={auth}>
      <App auth={auth} />
    </AuthGate>
  )
}
