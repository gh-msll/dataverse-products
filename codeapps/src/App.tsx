import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './App.css'
import { Alm_productsesService } from './generated/services/Alm_productsesService'
import { MicrosoftCopilotStudioService } from './generated/services/MicrosoftCopilotStudioService'
import type { Alm_productses } from './generated/models/Alm_productsesModel'

type AgentReply = {
  responses?: string[]
  lastResponse?: string
  conversationId?: string
  ConversationId?: string
  completed?: boolean
}

type ChatMessage = { role: 'user' | 'agent'; text: string }

const copilotAgentName = 'csa_AgentFirst'
const environmentId = '7254e823-a8bc-e7f5-95b7-43b7ff327319'

type ProductForm = {
  name: string
  sku: string
  description: string
}

const emptyForm: ProductForm = { name: '', sku: '', description: '' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function App() {
  const [products, setProducts] = useState<Alm_productses[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Alm_productses | null>(null)
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentInput, setAgentInput] = useState('')
  const [agentMessages, setAgentMessages] = useState<ChatMessage[]>([])
  const [agentConversationId, setAgentConversationId] = useState<string | undefined>()
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentError, setAgentError] = useState<string | null>(null)

  const loadProducts = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const result = await Alm_productsesService.getAll({
        select: ['alm_productsid', 'alm_productname', 'alm_skunumber', 'alm_productdescription'],
        orderBy: ['alm_productname asc'],
        maxPageSize: 100,
      })
      if (!result.success) throw result.error ?? new Error('Unable to load products.')
      setProducts(result.data ?? [])
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadProducts(), 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadProducts])

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return products
    return products.filter((product) =>
      [product.alm_productname, product.alm_skunumber, product.alm_productdescription]
        .some((value) => value?.toLocaleLowerCase().includes(query)),
    )
  }, [products, search])

  const catalogStats = useMemo(() => {
    const withSku = products.filter((product) => product.alm_skunumber?.trim()).length
    const withDescription = products.filter((product) => product.alm_productdescription?.trim()).length
    return {
      total: products.length,
      withSku,
      withDescription,
      skuPercent: products.length ? Math.round((withSku / products.length) * 100) : 0,
      descriptionPercent: products.length ? Math.round((withDescription / products.length) * 100) : 0,
    }
  }, [products])

  function openCreateDialog() {
    setEditingProduct(null)
    setForm(emptyForm)
    setError(null)
    setDialogOpen(true)
  }

  function openEditDialog(product: Alm_productses) {
    setEditingProduct(product)
    setForm({
      name: product.alm_productname ?? '',
      sku: product.alm_skunumber ?? '',
      description: product.alm_productdescription ?? '',
    })
    setError(null)
    setDialogOpen(true)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)

    const fields = {
      alm_productname: form.name.trim(),
      alm_skunumber: form.sku.trim() || undefined,
      alm_productdescription: form.description.trim() || undefined,
    }

    try {
      const result = editingProduct
        ? await Alm_productsesService.update(editingProduct.alm_productsid, fields)
        : await Alm_productsesService.create(
            // Dataverse supplies ownership and state defaults for new records.
            fields as unknown as Parameters<typeof Alm_productsesService.create>[0],
          )
      if (!result.success) throw result.error ?? new Error('Unable to save this product.')

      setDialogOpen(false)
      setNotice(editingProduct ? 'Product updated.' : 'Product created.')
      await loadProducts(false)
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(product: Alm_productses) {
    const name = product.alm_productname || 'this product'
    if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return

    setDeletingId(product.alm_productsid)
    setError(null)
    setNotice(null)
    try {
      await Alm_productsesService.delete(product.alm_productsid)
      setProducts((current) => current.filter((item) => item.alm_productsid !== product.alm_productsid))
      setNotice('Product deleted.')
    } catch (deleteError) {
      setError(errorMessage(deleteError))
    } finally {
      setDeletingId(null)
    }
  }

  async function sendAgentMessage(message = agentInput) {
    const text = message.trim()
    if (!text || agentBusy) return

    setAgentInput('')
    setAgentError(null)
    setAgentMessages((current) => [...current, { role: 'user', text }])
    setAgentBusy(true)
    try {
      const operation = await MicrosoftCopilotStudioService.ExecuteCopilotAsyncV2(
        copilotAgentName,
        { message: text, notificationUrl: 'https://notificationurlplaceholder' },
        agentConversationId,
        environmentId,
      )
      if (!operation.success) throw operation.error ?? new Error('The agent could not answer right now.')

      const reply = operation.data as unknown as AgentReply | undefined
      const conversationId = reply?.conversationId ?? reply?.ConversationId
      if (conversationId) setAgentConversationId(conversationId)
      const answer = reply?.lastResponse ?? reply?.responses?.filter(Boolean).join('\n\n')
      if (!answer) {
        throw new Error('The agent returned no message. Confirm Agent First is published and that its Microsoft Copilot Studio connection is available in this environment.')
      }
      setAgentMessages((current) => [...current, { role: 'agent', text: answer }])
    } catch (sendError) {
      setAgentError(errorMessage(sendError))
    } finally {
      setAgentBusy(false)
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand" href="#products" aria-label="Northstar home">
          <span className="brand-mark">N</span>
          <span>northstar<span className="brand-dot">.</span></span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <a className="nav-link active" href="#products">
          <span className="nav-icon" aria-hidden="true">▦</span> Products
        </a>
        <div className="sidebar-bottom">
          <span className="avatar">P</span>
          <span className="profile-copy"><strong>Power Apps</strong><small>Dataverse workspace</small></span>
        </div>
      </aside>

      <section className="main-area" id="products">
        <header className="topbar">
          <span className="breadcrumb">Workspace <span>/</span> Products</span>
          <span className="connection"><i /> Dataverse</span>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">CATALOG MANAGEMENT</p>
              <h1>Products</h1>
              <p className="subtitle">Manage your product catalog in one place.</p>
            </div>
            <button className="button button-primary" onClick={openCreateDialog}>
              <span aria-hidden="true">＋</span> Add product
            </button>
          </div>

          <section className="insights-grid" aria-label="Catalog overview">
            <article className="insight-card insight-total">
              <div className="insight-topline"><span className="insight-icon">▦</span><span className="insight-kicker">IN YOUR CATALOG</span></div>
              <div className="insight-value">{loading ? '—' : catalogStats.total}</div>
              <div className="insight-label">Total products</div>
              <div className="insight-decoration" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
            </article>
            <article className="insight-card insight-sku">
              <div className="insight-topline"><span className="insight-icon">⌗</span><span className="insight-kicker">IDENTIFIERS</span></div>
              <div className="insight-value">{loading ? '—' : catalogStats.withSku}<span className="insight-total-suffix"> / {loading ? '—' : catalogStats.total}</span></div>
              <div className="insight-label">Products with SKU</div>
              <div className="insight-progress"><span style={{ width: `${loading ? 0 : catalogStats.skuPercent}%` }} /></div>
            </article>
            <article className="insight-card insight-description">
              <div className="insight-topline"><span className="insight-icon">✧</span><span className="insight-kicker">CATALOG QUALITY</span></div>
              <div className="insight-value">{loading ? '—' : catalogStats.descriptionPercent}<span className="insight-percent">%</span></div>
              <div className="insight-label">Have a description <span>· {loading ? '—' : catalogStats.withDescription} products</span></div>
              <div className="insight-progress"><span style={{ width: `${loading ? 0 : catalogStats.descriptionPercent}%` }} /></div>
            </article>
          </section>

          <section className="catalog-card" aria-label="Product catalog">
            <div className="catalog-toolbar">
              <div>
                <h2>All products <span className="count-badge">{products.length}</span></h2>
                <p>Products connected to your Dataverse environment</p>
              </div>
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search products..."
                  aria-label="Search products"
                />
                <kbd>⌘ K</kbd>
              </label>
            </div>

            {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
            {error && !dialogOpen && (
              <div className="alert" role="alert">
                <span>{error}</span>
                <button className="button button-small" onClick={() => void loadProducts()}>Retry</button>
              </div>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>PRODUCT</th><th>SKU</th><th>DESCRIPTION</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={4} className="table-state"><span className="spinner" /> Loading products…</td></tr>
                  ) : filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="table-state empty-state">
                        <span className="empty-icon" aria-hidden="true">▧</span>
                        <strong>{search ? 'No matching products' : 'Your catalog is empty'}</strong>
                        <span>{search ? 'Try a different search term.' : 'Add a product to get your catalog started.'}</span>
                        {!search && <button className="button button-secondary" onClick={openCreateDialog}>Add your first product</button>}
                      </td>
                    </tr>
                  ) : filteredProducts.map((product) => (
                    <tr key={product.alm_productsid}>
                      <td>
                        <div className="product-cell">
                          <span className="product-mark">{(product.alm_productname || '?').charAt(0).toLocaleUpperCase()}</span>
                          <span className="product-name">{product.alm_productname || 'Untitled product'}</span>
                        </div>
                      </td>
                      <td><span className="sku">{product.alm_skunumber || '—'}</span></td>
                      <td><span className="description">{product.alm_productdescription || '—'}</span></td>
                      <td>
                        <div className="row-actions">
                          <button className="icon-button" onClick={() => openEditDialog(product)} aria-label={`Edit ${product.alm_productname || 'product'}`}>✎</button>
                          <button className="icon-button danger" onClick={() => void handleDelete(product)} disabled={deletingId === product.alm_productsid} aria-label={`Delete ${product.alm_productname || 'product'}`}>
                            {deletingId === product.alm_productsid ? '…' : '⌫'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="catalog-footer">
              <span>Showing <strong>{filteredProducts.length}</strong> of <strong>{products.length}</strong> products</span>
              <button className="button button-quiet" onClick={() => void loadProducts()} disabled={loading}>↻ <span>Refresh</span></button>
            </footer>
          </section>
          <p className="page-footnote">Product data is stored securely in your Dataverse environment.</p>
        </div>
      </section>

      {dialogOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDialogOpen(false) }}>
          <section className="product-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <div className="dialog-heading">
              <div><p className="eyebrow">PRODUCT DETAILS</p><h2 id="dialog-title">{editingProduct ? 'Edit product' : 'Add a product'}</h2></div>
              <button className="icon-button" onClick={() => setDialogOpen(false)} disabled={saving} aria-label="Close dialog">×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <label className="field-label" htmlFor="product-name">Product name <span>*</span></label>
              <input id="product-name" autoFocus required maxLength={850} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Wireless Headphones" />

              <label className="field-label" htmlFor="product-sku">SKU number</label>
              <input id="product-sku" maxLength={100} value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="e.g. WH-1000" />

              <label className="field-label" htmlFor="product-description">Description</label>
              <textarea id="product-description" rows={4} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Add a short description..." />
              <div className="field-hint">{form.description.length}/2000 characters</div>

              {error && <div className="alert dialog-alert" role="alert">{error}</div>}
              <div className="dialog-actions">
                <button type="button" className="button button-secondary" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</button>
                <button type="submit" className="button button-primary" disabled={saving}>
                  {saving ? 'Saving…' : editingProduct ? 'Save changes' : 'Create product'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {agentOpen && (
        <section className="agent-panel" aria-label="Product assistant" aria-live="polite">
          <header className="agent-header">
            <span className="agent-avatar" aria-hidden="true">✦</span>
            <div className="agent-title"><strong>Product assistant</strong><span><i /> Agent First · Dataverse</span></div>
            <button className="agent-close" onClick={() => setAgentOpen(false)} aria-label="Close assistant">×</button>
          </header>
          <div className="agent-chat-body">
            {agentMessages.length === 0 ? (
              <div className="agent-welcome">
                <span className="welcome-sparkle" aria-hidden="true">✦</span>
                <h2>How can I help?</h2>
                <p>Ask me about products in your catalog.</p>
                <div className="agent-suggestions">
                  <button onClick={() => void sendAgentMessage('List the products in the catalog')}>List my products <span>↗</span></button>
                  <button onClick={() => void sendAgentMessage('Which products are missing an SKU?')}>Find products missing an SKU <span>↗</span></button>
                  <button onClick={() => void sendAgentMessage('Summarize the product catalog')}>Summarize my catalog <span>↗</span></button>
                </div>
              </div>
            ) : (
              <div className="agent-transcript">
                {agentMessages.map((message, index) => (
                  <article className={`chat-bubble ${message.role}`} key={`${message.role}-${index}`}>
                    {message.role === 'agent' && <span className="bubble-avatar" aria-hidden="true">✦</span>}
                    <div className="chat-message-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                    </div>
                  </article>
                ))}
                {agentBusy && <div className="agent-thinking"><span className="thinking-dots"><i /><i /><i /></span> Agent First is thinking…</div>}
                {agentError && <div className="agent-error" role="alert">{agentError}</div>}
              </div>
            )}
            {agentError && agentMessages.length === 0 && <div className="agent-error" role="alert">{agentError}</div>}
          </div>
          <form className="agent-composer" onSubmit={(event) => { event.preventDefault(); void sendAgentMessage() }}>
            <textarea
              value={agentInput}
              onChange={(event) => setAgentInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendAgentMessage() } }}
              placeholder="Ask about your products…"
              aria-label="Message Product assistant"
              rows={1}
              disabled={agentBusy}
            />
            <button type="submit" disabled={!agentInput.trim() || agentBusy} aria-label="Send message">➤</button>
            <small>AI can make mistakes. Verify important product details.</small>
          </form>
        </section>
      )}
      <button className={`agent-launcher${agentOpen ? ' is-open' : ''}`} onClick={() => setAgentOpen((open) => !open)} aria-label={agentOpen ? 'Close product assistant' : 'Open product assistant'} aria-expanded={agentOpen}>
        {agentOpen ? '×' : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-1 2.5L7.2 19a7.5 7.5 0 1 1 12.8-7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M8.5 11.5h7M8.5 14.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>}
      </button>
    </main>
  )
}

export default App
