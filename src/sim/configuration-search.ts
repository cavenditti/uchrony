/** Search is indexed once: typing only compares terms against existing strings. */
import {
  CONFIGURATION_FIELDS_BY_GROUP,
  CONFIGURATION_GROUPS,
  type ConfigurationField,
  type ConfigurationGroupMeta,
} from './configuration-schema'
import type { ConfigurationValues } from './configuration-defaults'

/** Matching fields retain the editor's section and parameter order. */
export interface ConfigurationSearchGroup {
  readonly key: keyof ConfigurationValues
  readonly group: ConfigurationGroupMeta
  readonly fields: readonly ConfigurationField[]
}

const SEARCH_GROUPS = Object.entries(CONFIGURATION_GROUPS).map(([key, group]) => ({
  key: key as keyof ConfigurationValues,
  group,
  entries: CONFIGURATION_FIELDS_BY_GROUP[key as keyof ConfigurationValues].map((field) => ({
    field,
    text: [
      group.label,
      group.description,
      field.label,
      field.path,
      field.description,
      field.unit ?? '',
      ...(field.options ?? []),
      ...field.tags,
    ]
      .join(' ')
      .toLowerCase(),
  })),
}))

/**
 * Every whitespace-separated term must match, in any order or metadata field.
 * Starting conditions and geography keep their creation-only visibility rule;
 * other creation-only controls remain visible but locked in the live editor.
 */
export function searchConfigurationGroups(query: string, live = false): ConfigurationSearchGroup[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return SEARCH_GROUPS.flatMap(({ key, group, entries }) => {
    if (live && (key === 'starting' || key === 'geography')) return []
    const fields = entries
      .filter(({ text }) => terms.every((term) => text.includes(term)))
      .map(({ field }) => field)
    return fields.length ? [{ key, group, fields }] : []
  })
}
