import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const PLACEHOLDER_RE = /\[[^\[\]\n]+\](?![\(\[])/g
const key = new PluginKey('raPlaceholderHighlight')

/**
 * Non-destructive highlight for remaining [bracket] gaps in the policy paper.
 * Decorations only — does not alter serialized markdown.
 */
export const PlaceholderHighlight = Extension.create({
  name: 'placeholderHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const marks: ReturnType<typeof Decoration.inline>[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              const text = node.text
              const re = new RegExp(PLACEHOLDER_RE.source, PLACEHOLDER_RE.flags)
              let match: RegExpExecArray | null
              while ((match = re.exec(text)) !== null) {
                const from = pos + match.index
                const to = from + match[0].length
                marks.push(
                  Decoration.inline(from, to, {
                    class: 'ra-placeholder-mark',
                  }),
                )
              }
            })
            return DecorationSet.create(state.doc, marks)
          },
        },
      }),
    ]
  },
})
