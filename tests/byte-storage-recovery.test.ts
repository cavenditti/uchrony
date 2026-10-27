import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { MessageChannel } from 'node:worker_threads'
import { ByteStorageClient } from '../src/storage/byte-client'

function connection(client: ByteStorageClient) {
  const channel = new MessageChannel()
  client.connect(channel.port1 as unknown as MessagePort)
  return channel
}

test('a crashed writer resumes unconfirmed replicas with the same captured bytes', async () => {
  const client = new ByteStorageClient(),
    first = connection(client)
  const blob = new Blob(['immutable save before the next simulation tick'])
  const initial: { id: number; backend: string; blob: Blob }[] = []
  first.port2.on('message', (message) => initial.push(message))
  const disk = client.backend('disk').writeBlob!(blob),
    browser = client.backend('browser').writeBlob!(blob)
  while (initial.length < 2) await once(first.port2, 'message')
  client.interrupted('Failed to load worker module')
  first.port2.close()
  const replacement = connection(client)
  const resumed: { id: number; backend: string; blob: Blob }[] = []
  replacement.port2.on('message', (message) => {
    resumed.push(message)
    replacement.port2.postMessage({ id: message.id })
  })
  try {
    await Promise.all([disk, browser])
    assert.deepEqual(
      resumed.map(({ id, backend }) => ({ id, backend })),
      initial.map(({ id, backend }) => ({ id, backend })),
    )
    for (const message of resumed) assert.equal(await message.blob.text(), await blob.text())
  } finally {
    client.disconnect()
    replacement.port2.close()
  }
})

test('confirmed replicas are not replayed and late responses from the old writer are ignored', async () => {
  const client = new ByteStorageClient(),
    first = connection(client)
  const stale = first.port1.onmessage!
  first.port2.on('message', ({ id, backend }) => {
    if (backend === 'disk') first.port2.postMessage({ id })
  })
  await client.backend('disk').writeBlob!(new Blob(['confirmed']))
  const pending = client.backend('browser').writeBlob!(new Blob(['pending']))
  const [message] = await once(first.port2, 'message')
  client.interrupted()
  first.port2.close()
  const replacement = connection(client)
  let settled = false
  void pending.then(() => {
    settled = true
  })
  stale.call(first.port1, { data: { id: message.id } } as MessageEvent)
  await Promise.resolve()
  assert.equal(settled, false)
  const [retry] = await once(replacement.port2, 'message')
  assert.equal(retry.backend, 'browser')
  replacement.port2.postMessage({ id: retry.id })
  try {
    await pending
  } finally {
    client.disconnect()
    replacement.port2.close()
  }
})

test('repeated crashes stop after three sends and retain the actual worker error', async () => {
  const client = new ByteStorageClient()
  let channel = connection(client)
  const pending = client.backend('disk').writeBlob!(new Blob(['bounded retry']))
  const rejected = assert.rejects(pending, /worker module unavailable/)
  for (let attempt = 0; attempt < 3; attempt++) {
    await once(channel.port2, 'message')
    client.interrupted('worker module unavailable')
    channel.port2.close()
    if (attempt < 2) channel = connection(client)
  }
  await rejected
  client.disconnect()
})

test('a missing replacement has a deadline and a later connection can save again', async () => {
  const client = new ByteStorageClient(40),
    channel = connection(client)
  const pending = client.backend('browser').writeBlob!(new Blob(['expired']))
  const rejected = assert.rejects(pending, /worker unavailable.*Reconnecting timed out/)
  client.interrupted('worker unavailable')
  channel.port2.close()
  await rejected
  const replacement = connection(client)
  replacement.port2.on('message', ({ id }) => replacement.port2.postMessage({ id }))
  try {
    await client.backend('browser').writeBlob!(new Blob(['new snapshot']))
  } finally {
    client.disconnect()
    replacement.port2.close()
  }
})

test('an unresponsive writer cannot retain a save flight indefinitely', async () => {
  const client = new ByteStorageClient(30),
    channel = connection(client)
  try {
    await assert.rejects(
      client.backend('disk').writeBlob!(new Blob(['unacknowledged'])),
      /did not respond in time/,
    )
  } finally {
    client.disconnect()
    channel.port2.close()
  }
})
