import { useState } from 'react'
import heroImg from './assets/hero.png'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <button onClick={async () =>{
        const porta = await navigator.serial.requestPort();
        await porta.open({ baudRate: 1000000 });
        const scrittore = porta.writable.getWriter();
        const lettore   = porta.readable.getReader();
        const ping = [0xFF, 0xFF, 0x01, 0x02, 0x01, 0xFB];
        await scrittore.write(new Uint8Array(ping));
        const { value } = await lettore.read(); 
        const response = [...value];
        console.log("risposta:", response);
      } }>Send</button>
    </>
  )
}

export default App
