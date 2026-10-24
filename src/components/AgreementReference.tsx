import { agreementTitle, splitAgreementReferences, visibleAgreement } from '../sim/agreement-references'
import { dateLabel, type World } from '../sim/types'

export interface AgreementReferenceProps {
  world: World
  nation: number
  confidential: boolean
  onOpen: (id: number) => void
}
export function AgreementReference({
  id,
  world,
  nation,
  confidential,
  onOpen,
}: AgreementReferenceProps & { id: number }) {
  const offer = visibleAgreement(world.statecraft?.offers ?? [], id, nation, confidential)
  if (!offer)
    return (
      <span className="agreement-unavailable" title="This agreement is not available in the current archive.">
        Agreement unavailable
      </span>
    )
  return (
    <a
      className="agreement-link"
      href={`#agreement-${offer.id}`}
      title={`${agreementTitle(offer)} · ${dateLabel({ month: offer.month, startYear: world.startYear })} · ${offer.status}`}
      onClick={(event) => {
        event.preventDefault()
        onOpen(offer.id)
      }}
    >
      {agreementTitle(offer)}
    </a>
  )
}
export function AgreementText({ text, ...props }: AgreementReferenceProps & { text: string }) {
  return (
    <>
      {splitAgreementReferences(text).map((part, index) =>
        part.agreement === undefined ? (
          part.text
        ) : (
          <AgreementReference key={index} {...props} id={part.agreement} />
        ),
      )}
    </>
  )
}
