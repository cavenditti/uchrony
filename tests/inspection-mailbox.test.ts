import test from 'node:test'
import assert from 'node:assert/strict'
import { InspectionMailbox } from '../src/inspection-mailbox'
import type { InspectionRequest } from '../src/sim/inspection'

test('rapid camera motion keeps only the current query and latest requested area', () => {
  const sent: InspectionRequest[] = [],
    mailbox = new InspectionMailbox((request) => sent.push(request))
  const request = (id: number): InspectionRequest => ({
    id,
    bounds: { x: id, y: 0, size: 1000 },
    detail: 'street',
  })
  for (let id = 1; id <= 100; id++) mailbox.submit(request(id))
  assert.deepEqual(
    sent.map((r) => r.id),
    [1],
  )
  mailbox.settle(1)
  assert.deepEqual(sent, [request(1), request(100)])
  mailbox.submit(request(101))
  mailbox.settle(1) // A duplicate old response cannot release the current flight.
  assert.equal(sent.length, 2)
  mailbox.clear() // Closing inspection discards the pending area.
  mailbox.settle(100)
  assert.equal(sent.length, 2)
  mailbox.submit(request(102))
  assert.deepEqual(
    sent.map((r) => r.id),
    [1, 100, 102],
  )
})
