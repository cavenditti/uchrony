import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Send, X } from 'lucide-react'
import { ADVICE_LENGTH, ADVICE_PENDING, pendingAdvice } from '../sim/advisors'
import { dateLabel, type World } from '../sim/types'
import { inWorldText } from '../sim/narrative'

export function StateAdvisor({
  world,
  nation,
  onSend,
  onWithdraw,
}: {
  world: World
  nation: number
  onSend: (nation: number, text: string) => void
  onWithdraw: (nation: number, id: number) => void
}) {
  const [draft, setDraft] = useState('')
  const sent = useRef<string | null>(null)
  const state = world.nations[nation],
    agent = world.statecraft?.agents.find((a) => a.nation === nation),
    notes = agent?.advisor?.notes ?? [],
    waiting = agent ? pendingAdvice(agent).length : 0,
    duplicate = notes.some((note) => note.status === 'pending' && note.text.trim() === draft.trim())
  useEffect(() => {
    // Clear only after the worker has actually recorded this text. An error
    // leaves the draft available, and editing a new draft never loses it.
    if (sent.current && notes.some((note) => note.text === sent.current)) {
      if (draft.trim() === sent.current) setDraft('')
      sent.current = null
    }
  }, [notes, draft])
  const date = (month: number) => dateLabel({ month, startYear: world.startYear })
  return (
    <details className="state-adviser">
      <summary>
        <MessageSquare size={14} />
        <span>Advise government</span>
        {waiting > 0 && <small>{waiting} awaiting assessment</small>}
      </summary>
      <div className="adviser-content">
        <p>
          Private suggestions for {state.name}. The government may adapt, decline or ignore your advice; it
          keeps its own goals and authority.
        </p>
        {!state.ai && (
          <p className="adviser-control-note">
            You retain direct control of this state. Sending advice does not restore its autonomy or override
            your decisions.
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (
              !draft.trim() ||
              draft.trim().length > ADVICE_LENGTH ||
              waiting >= ADVICE_PENDING ||
              duplicate
            )
              return
            sent.current = draft.trim()
            onSend(nation, draft.trim())
          }}
        >
          <label htmlFor={`advice-${nation}`}>Your suggestion</label>
          <textarea
            id={`advice-${nation}`}
            value={draft}
            maxLength={ADVICE_LENGTH}
            rows={4}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What should this government consider, and why?"
            aria-describedby={`advice-help-${nation}`}
          />
          <div className="adviser-compose-footer">
            <small>
              {draft.length}/{ADVICE_LENGTH}
            </small>
            <button
              type="submit"
              className="button"
              disabled={!draft.trim() || waiting >= ADVICE_PENDING || duplicate}
            >
              <Send size={13} />
              Send suggestion
            </button>
          </div>
          <p id={`advice-help-${nation}`} className="adviser-help">
            {waiting >= ADVICE_PENDING
              ? 'Four suggestions are waiting. Withdraw one or wait for an assessment.'
              : 'Delivered at its next assessment. The simulation continues while the government deliberates.'}
          </p>
        </form>
        {notes.length > 0 && (
          <div className="adviser-notes" aria-live="polite" aria-relevant="additions text">
            <h4>Your advice and government responses</h4>
            {[...notes].reverse().map((note) => (
              <article key={note.id} className="adviser-note">
                <div className="adviser-note-heading">
                  <time>{date(note.month)}</time>
                  <span>
                    {note.status === 'pending'
                      ? 'Awaiting assessment'
                      : note.status === 'answered'
                        ? 'Government response'
                        : note.status === 'withdrawn'
                          ? 'Withdrawn'
                          : 'Delivered in assessment'}
                  </span>
                  {note.status === 'pending' && (
                    <button
                      className="icon-button"
                      aria-label={`Withdraw suggestion from ${date(note.month)}: ${note.text.slice(0, 45)}`}
                      title="Withdraw undelivered suggestion"
                      onClick={() => onWithdraw(nation, note.id)}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <p>{inWorldText(note.text)}</p>
                {note.response && (
                  <div className="adviser-response">
                    <strong>
                      {state.shortName} · {date(note.handledMonth!)}
                    </strong>
                    <p>{inWorldText(note.response)}</p>
                  </div>
                )}
                {note.status === 'delivered' && (
                  <small>Included in the government’s assessment; no separate reply was given.</small>
                )}
              </article>
            ))}
            <p className="adviser-help">
              Responses express intentions and judgments. Actions still depend on the state’s decisions and
              circumstances.
            </p>
          </div>
        )}
      </div>
    </details>
  )
}
