'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { slugify } from '@/lib/slugify'

type Suggestion = {
  normalized_text: string
  sample_text: string
  profile_count: number
  first_seen_at: string
  last_seen_at: string
}

type Dismissed = {
  normalized_text: string
  sample_text: string
  dismissed_at: string
}

type ApproveForm = {
  name: string
  slug: string
  nameBn: string
  type: '' | 'public' | 'private'
  city: string
  division: string
  lat: string
  lng: string
}

function toApproveForm(sampleText: string): ApproveForm {
  const name = sampleText.trim()
  return { name, slug: slugify(name), nameBn: '', type: '', city: '', division: '', lat: '', lng: '' }
}

export default function AdminUniversitySuggestionsPage() {
  const router = useRouter()
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [dismissed, setDismissed] = useState<Dismissed[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'dismissed'>('pending')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [forms, setForms] = useState<Record<string, ApproveForm>>({})

  useEffect(() => {
    async function load() {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData.user) { router.push('/auth/login'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', authData.user.id)
        .single()

      if (profile?.role !== 'admin') { router.push('/'); return }

      const [{ data: pending, error: pendingError }, { data: dismissedRows, error: dismissedError }] = await Promise.all([
        supabase.rpc('admin_list_university_suggestions'),
        supabase.rpc('admin_list_dismissed_university_suggestions'),
      ])

      if (pendingError) toast.error('Failed to load suggestions: ' + pendingError.message)
      else setSuggestions((pending ?? []) as Suggestion[])

      if (dismissedError) toast.error('Failed to load dismissed suggestions: ' + dismissedError.message)
      else setDismissed((dismissedRows ?? []) as Dismissed[])

      setLoading(false)
    }
    load()
  }, [router])

  async function callApi(body: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return { ok: false, error: 'Not logged in' }

    const res = await fetch('/api/admin/university-suggestions', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data.error || 'Action failed' }
    return { ok: true, data }
  }

  function openApprove(s: Suggestion) {
    setForms((prev) => ({ ...prev, [s.normalized_text]: prev[s.normalized_text] ?? toApproveForm(s.sample_text) }))
    setExpanded(s.normalized_text)
  }

  function updateForm(normalizedText: string, patch: Partial<ApproveForm>) {
    setForms((prev) => ({ ...prev, [normalizedText]: { ...prev[normalizedText], ...patch } }))
  }

  async function submitApprove(normalizedText: string) {
    const form = forms[normalizedText]
    if (!form?.name.trim() || !form.slug.trim()) {
      toast.error('Name and slug are required')
      return
    }

    setActing(normalizedText)
    const result = await callApi({
      action: 'approve',
      normalizedText,
      name: form.name.trim(),
      slug: form.slug.trim(),
      nameBn: form.nameBn.trim() || null,
      type: form.type || null,
      city: form.city.trim() || null,
      division: form.division.trim() || null,
      lat: form.lat ? Number(form.lat) : null,
      lng: form.lng ? Number(form.lng) : null,
    })
    setActing(null)

    if (!result.ok) {
      toast.error(result.error)
      return
    }

    toast.success(`Approved — ${result.data.linkedCount} profile(s) linked`)
    setSuggestions((prev) => prev.filter((s) => s.normalized_text !== normalizedText))
    setExpanded(null)
  }

  async function dismiss(s: Suggestion) {
    setActing(s.normalized_text)
    const result = await callApi({ action: 'dismiss', normalizedText: s.normalized_text, sampleText: s.sample_text })
    setActing(null)

    if (!result.ok) {
      toast.error(result.error)
      return
    }

    setSuggestions((prev) => prev.filter((x) => x.normalized_text !== s.normalized_text))
    setDismissed((prev) => [{ normalized_text: s.normalized_text, sample_text: s.sample_text, dismissed_at: new Date().toISOString() }, ...prev])
    toast.success('Dismissed')
  }

  async function undismiss(d: Dismissed) {
    setActing(d.normalized_text)
    const result = await callApi({ action: 'undismiss', normalizedText: d.normalized_text })
    setActing(null)

    if (!result.ok) {
      toast.error(result.error)
      return
    }

    setDismissed((prev) => prev.filter((x) => x.normalized_text !== d.normalized_text))
    setSuggestions((prev) => [
      { normalized_text: d.normalized_text, sample_text: d.sample_text, profile_count: 0, first_seen_at: d.dismissed_at, last_seen_at: d.dismissed_at },
      ...prev,
    ])
    toast.success('Restored to Pending')
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-gray-400">Loading suggestions...</p>
      </div>
    )
  }

  const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">University Suggestions</h1>
        <p className="mt-1 text-sm text-gray-400">
          Free-text university names students typed that don&apos;t match anything in the list yet.
        </p>
      </div>

      <div className="mb-5 flex gap-2">
        {[
          { key: 'pending', label: `⏳ Pending (${suggestions.length})` },
          { key: 'dismissed', label: `🗂 Dismissed (${dismissed.length})` },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key as 'pending' | 'dismissed')}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              filter === tab.key
                ? 'border-teal-600 bg-teal-600 text-white'
                : 'border-gray-200 text-gray-500 hover:border-gray-400 dark:border-gray-700 dark:text-gray-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filter === 'pending' ? (
        suggestions.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center dark:border-gray-700 dark:bg-gray-800">
            <p className="text-4xl mb-2">🎓</p>
            <p className="text-gray-400">No pending suggestions</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {suggestions.map((s) => (
              <div
                key={s.normalized_text}
                className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 sm:p-5"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-gray-900 dark:text-white">
                      {s.sample_text}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      First seen {new Date(s.first_seen_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                      {' · '}
                      Last seen {new Date(s.last_seen_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
                    {s.profile_count} student{s.profile_count === 1 ? '' : 's'}
                  </span>
                </div>

                {expanded === s.normalized_text ? (
                  <div className="mt-3 flex flex-col gap-3 rounded-xl border border-gray-100 p-4 dark:border-gray-700">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Name *</label>
                        <input
                          className={inputCls}
                          value={forms[s.normalized_text]?.name ?? ''}
                          onChange={(e) => updateForm(s.normalized_text, { name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Slug *</label>
                        <input
                          className={inputCls}
                          value={forms[s.normalized_text]?.slug ?? ''}
                          onChange={(e) => updateForm(s.normalized_text, { slug: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Name (Bangla)</label>
                        <input
                          className={inputCls}
                          value={forms[s.normalized_text]?.nameBn ?? ''}
                          onChange={(e) => updateForm(s.normalized_text, { nameBn: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Type</label>
                        <select
                          className={inputCls}
                          value={forms[s.normalized_text]?.type ?? ''}
                          onChange={(e) => updateForm(s.normalized_text, { type: e.target.value as ApproveForm['type'] })}
                        >
                          <option value="">Unknown</option>
                          <option value="public">Public</option>
                          <option value="private">Private</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">City</label>
                        <input
                          className={inputCls}
                          value={forms[s.normalized_text]?.city ?? ''}
                          onChange={(e) => updateForm(s.normalized_text, { city: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Division</label>
                        <input
                          className={inputCls}
                          value={forms[s.normalized_text]?.division ?? ''}
                          onChange={(e) => updateForm(s.normalized_text, { division: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Latitude (optional)</label>
                        <input
                          type="number"
                          className={inputCls}
                          value={forms[s.normalized_text]?.lat ?? ''}
                          onChange={(e) => updateForm(s.normalized_text, { lat: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Longitude (optional)</label>
                        <input
                          type="number"
                          className={inputCls}
                          value={forms[s.normalized_text]?.lng ?? ''}
                          onChange={(e) => updateForm(s.normalized_text, { lng: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setExpanded(null)}
                        className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => submitApprove(s.normalized_text)}
                        disabled={acting === s.normalized_text}
                        className="flex-1 rounded-xl bg-teal-600 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                      >
                        {acting === s.normalized_text ? 'Creating...' : 'Create University'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
                    <button
                      onClick={() => openApprove(s)}
                      disabled={acting === s.normalized_text}
                      className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      ✓ Approve
                    </button>
                    <button
                      onClick={() => dismiss(s)}
                      disabled={acting === s.normalized_text}
                      className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-700"
                    >
                      {acting === s.normalized_text ? '...' : 'Dismiss'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : dismissed.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center dark:border-gray-700 dark:bg-gray-800">
          <p className="text-4xl mb-2">🗂</p>
          <p className="text-gray-400">Nothing dismissed</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {dismissed.map((d) => (
            <div
              key={d.normalized_text}
              className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-700 dark:text-gray-300">{d.sample_text}</p>
                <p className="text-xs text-gray-400">
                  Dismissed {new Date(d.dismissed_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                </p>
              </div>
              <button
                onClick={() => undismiss(d)}
                disabled={acting === d.normalized_text}
                className="shrink-0 rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                {acting === d.normalized_text ? '...' : 'Undo'}
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
