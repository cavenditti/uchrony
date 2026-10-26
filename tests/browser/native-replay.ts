const worker = new Worker(new URL('./native-replay-worker.ts', import.meta.url), { type: 'module' })
const rows: unknown[] = []
worker.onmessage = ({ data }) => {
  if (data.blob) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(data.blob)
    a.download = `native-replay-${data.month}.json`
    a.id = `checkpoint-${data.month}`
    a.textContent = `Download month ${data.month}`
    document.querySelector('#downloads')!.append(a, document.createElement('br'))
  }
  const { blob: _blob, ...row } = data
  rows.push(row)
  document.querySelector('#status')!.textContent = JSON.stringify(rows, null, 2)
}
worker.onerror = (event) => {
  document.querySelector('#status')!.textContent += `\nERROR: ${event.message}`
}
document.querySelector<HTMLButtonElement>('#start')!.onclick = () => {
  const file = document.querySelector<HTMLInputElement>('#checkpoint')!.files?.[0]
  if (!file) throw new Error('Choose an exported starting world')
  document.querySelector<HTMLButtonElement>('#start')!.disabled = true
  worker.postMessage({ file, end: +document.querySelector<HTMLInputElement>('#end')!.value })
}
export {}
