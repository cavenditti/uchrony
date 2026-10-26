const output = document.querySelector('#result')!
const button = document.querySelector<HTMLButtonElement>('#run')!
button.onclick = () => {
  button.disabled = true
  const worker = new Worker(new URL('./influence-probe-worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }) => {
    output.textContent = JSON.stringify(data, null, 2)
    if (data.complete || data.error) {
      worker.terminate()
      button.disabled = false
    }
  }
  worker.onerror = (event) => {
    output.textContent = JSON.stringify({
      error: event.message || 'Worker failed to load or crashed',
      file: event.filename,
      line: event.lineno,
    })
    button.disabled = false
    worker.terminate()
  }
  output.textContent = 'Running'
  worker.postMessage({ run: true })
}
