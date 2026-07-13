import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { z } from 'zod'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    normalizedText: z.string().min(1),
    name: z.string().min(2),
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case'),
    nameBn: z.string().nullable().optional(),
    type: z.enum(['public', 'private']).nullable().optional(),
    city: z.string().nullable().optional(),
    division: z.string().nullable().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
  }),
  z.object({
    action: z.literal('dismiss'),
    normalizedText: z.string().min(1),
    sampleText: z.string(),
  }),
  z.object({
    action: z.literal('undismiss'),
    normalizedText: z.string().min(1),
  }),
])

export async function PATCH(req: NextRequest) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: callerProfile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single()

  if (callerProfile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { allowed } = await rateLimit(`admin-university-suggestion:${caller.id}`, 60, 60 * 1000)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const data = parsed.data

  if (data.action === 'approve') {
    const { data: university, error } = await supabaseAdmin
      .from('universities')
      .insert({
        name: data.name,
        slug: data.slug,
        name_bn: data.nameBn || null,
        type: data.type || null,
        city: data.city || null,
        division: data.division || null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A university with this slug already exists — edit the slug and retry.' },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data: linkedCount, error: backfillError } = await supabaseAdmin.rpc(
      'admin_backfill_university_suggestion',
      { p_normalized_text: data.normalizedText, p_university_id: university.id },
    )

    if (backfillError) {
      return NextResponse.json({ error: backfillError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, universityId: university.id, linkedCount: linkedCount ?? 0 })
  }

  if (data.action === 'dismiss') {
    const { error } = await supabaseAdmin
      .from('university_suggestion_dismissals')
      .upsert({
        normalized_text: data.normalizedText,
        sample_text: data.sampleText,
        dismissed_by: caller.id,
      })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  }

  // action === 'undismiss'
  const { error } = await supabaseAdmin
    .from('university_suggestion_dismissals')
    .delete()
    .eq('normalized_text', data.normalizedText)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
