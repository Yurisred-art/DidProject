import './App.css'
import { useServo } from './hooks/useServo'
import { useTraiettoria } from './hooks/useTraiettoria'
import { SchedaServo } from './components/SchedaServo'
import { PannelloTraiettoria } from './components/PannelloTraiettoria'

function App() {
  const servo = useServo()
  const traiettoria = useTraiettoria(servo)

  // i controlli sono disabilitati a linea chiusa, durante un comando o durante una traiettoria
  const bloccato = !servo.aperta || servo.occupato || traiettoria.inMoto

  return (
    <>
      <SchedaServo servo={servo} inMoto={traiettoria.inMoto} />
      <PannelloTraiettoria bloccato={bloccato} {...traiettoria} />
    </>
  )
}

export default App
