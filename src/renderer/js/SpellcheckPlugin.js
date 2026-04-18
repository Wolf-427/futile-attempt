// \p{M} captures combining diacritics (NFD) so "Wo\u0308rter" matches as one token.
// The u flag is required for \p{...} Unicode property escapes.
const WORD_RE = /[a-zA-ZÀ-ÖØ-öø-ÿ\u0100-\u024F\p{M}'\u2018\u2019]+/gu

function extractWords(doc) {
  const words = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    WORD_RE.lastIndex = 0
    let m
    while ((m = WORD_RE.exec(node.text)) !== null) {
      // Strip leading/trailing apostrophes (straight or curly), then NFC-normalise
      // so dictionary lookups always receive precomposed characters.
      const raw = m[0].replace(/^['\u2018\u2019]+|['\u2018\u2019]+$/g, '').normalize('NFC')
      if (raw.length < 2 || /^\d+$/.test(raw)) continue
      const leadTrim  = m[0].length - m[0].replace(/^['\u2018\u2019]+/, '').length
      const trailTrim = m[0].length - m[0].replace(/['\u2018\u2019]+$/, '').length
      // Use original match length (not NFC raw.length) so positions map back to
      // the actual document offsets even when the text is in NFD form.
      words.push({ word: raw, from: pos + m.index + leadTrim, to: pos + m.index + m[0].length - trailTrim })
    }
  })
  return words
}

export function createSpellcheckExtension(spellApi) {
  const { Extension, Plugin, PluginKey, DecorationSet, Decoration } = window.Tiptap
  const pluginKey = new PluginKey('spellcheck')
  let debounceTimer = null
  let currentView = null
  let enabled = true

  async function runCheck(view) {
    if (!enabled || !view || view.isDestroyed) return

    const words = extractWords(view.state.doc)
    const unique = [...new Set(words.map(w => w.word))]
    if (!unique.length) {
      dispatch(view, DecorationSet.empty)
      return
    }

    let misspelled
    try {
      misspelled = new Set(await spellApi.checkWords(unique))
    } catch {
      return
    }

    if (!misspelled.size) {
      dispatch(view, DecorationSet.empty)
      return
    }

    const decos = []
    for (const { word, from, to } of words) {
      if (misspelled.has(word)) {
        decos.push(Decoration.inline(from, to, {
          class: 'spell-error',
          'data-word': word,
          'data-from': String(from),
          'data-to': String(to),
        }))
      }
    }
    dispatch(view, DecorationSet.create(view.state.doc, decos))
  }

  function dispatch(view, decoSet) {
    if (!view || view.isDestroyed) return
    const tr = view.state.tr
    tr.setMeta(pluginKey, decoSet)
    tr.setMeta('addToHistory', false)
    view.dispatch(tr)
  }

  function schedule(view, delay = 600) {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => runCheck(view), delay)
  }

  // Called by EditorCore after a language change so the check runs immediately
  function forceRecheck() {
    if (currentView) schedule(currentView, 0)
  }

  // Listen for "word added to dictionary" from the context menu
  spellApi.onRecheck(() => forceRecheck())

  // Apply a suggestion chosen from the context menu
  spellApi.onReplace(({ from, to, replacement }) => {
    if (!currentView || currentView.isDestroyed) return
    const { state, dispatch } = currentView
    // Validate that the range still makes sense (document may have changed)
    if (from < 0 || to > state.doc.content.size || from >= to) return
    dispatch(state.tr.insertText(replacement, from, to))
  })

  const plugin = new Plugin({
    key: pluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, decos) {
        const next = tr.getMeta(pluginKey)
        if (next !== undefined) return next
        // Map existing decoration positions through any content changes
        return tr.docChanged ? decos.map(tr.mapping, tr.doc) : decos
      }
    },
    props: {
      decorations(state) { return pluginKey.getState(state) }
    },
    view(editorView) {
      currentView = editorView
      schedule(editorView, 800) // initial check after mount
      return {
        update(view, prevState) {
          if (view.state.doc !== prevState.doc) schedule(view)
        },
        destroy() {
          clearTimeout(debounceTimer)
          currentView = null
        }
      }
    }
  })

  const extension = Extension.create({
    name: 'spellcheck',
    addProseMirrorPlugins: () => [plugin]
  })

  function setEnabled(val) {
    enabled = val
    if (!val && currentView) dispatch(currentView, DecorationSet.empty)
    else if (val && currentView) schedule(currentView, 0)
  }

  // Attach forceRecheck so EditorCore can call it after a language switch
  extension.forceRecheck = forceRecheck
  extension.setEnabled = setEnabled

  return extension
}
