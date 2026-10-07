import './App.css'
import { useServo } from './hooks/useServo'
import { SchedaServo } from './components/SchedaServo'

function App() {
  const servo = useServo()
  return <SchedaServo servo={servo} />
}

export default App
