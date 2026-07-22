"use client";

import { Archive, ArchiveRestore, Mail, MessageSquareText, Plus } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createTemplate, saveReminderPolicy, setTemplateArchived, updateTemplate } from "./actions";

/**
 * Settings → Templates (M5): edit-in-place template list + create form +
 * the automatic-reminder policy card. Variable chips insert placeholders;
 * server actions re-validate everything (unknown variables, name clashes).
 */

type ActionResult = { error?: string; ok?: boolean } | null;

export type TemplateRow = {
  id: string;
  name: string;
  channel: "email" | "sms";
  subject: string | null;
  body: string;
  archived: boolean;
};

export type ReminderPolicy = {
  enabled: boolean;
  awaiting_docs_days: number;
  cadence_days: number;
  channel: "preferred" | "email" | "sms";
  template_id: string | null;
};

const inputCls =
  "h-9 px-3 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none w-full";
const textareaCls =
  "px-3 py-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none w-full min-h-28 font-mono";
const selectCls =
  "h-9 px-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none";

function VariableChips({ variables }: { variables: ReadonlyArray<{ name: string; description: string }> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {variables.map((v) => (
        <code
          key={v.name}
          title={v.description}
          className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
        >
          {`{${v.name}}`}
        </code>
      ))}
    </div>
  );
}

export function TemplatesManager({
  templates,
  variables,
  disabled,
}: {
  templates: TemplateRow[];
  variables: ReadonlyArray<{ name: string; description: string }>;
  disabled: boolean;
}) {
  const [showNew, setShowNew] = useState(false);
  const active = templates.filter((t) => !t.archived);
  const archived = templates.filter((t) => t.archived);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-xs text-slate-500">Placeholders you can use (hover for meaning):</p>
        <VariableChips variables={variables} />
      </div>

      <ul className="space-y-2">
        {active.map((t) => (
          <TemplateItem key={t.id} template={t} disabled={disabled} />
        ))}
        {active.length === 0 && <p className="text-sm text-slate-400">No templates yet.</p>}
      </ul>

      {!disabled &&
        (showNew ? (
          <NewTemplateForm onDone={() => setShowNew(false)} />
        ) : (
          <Button variant="outline" size="sm" onClick={() => setShowNew(true)}>
            <Plus /> New template
          </Button>
        ))}

      {archived.length > 0 && (
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <p className="text-xs text-slate-500">Archived</p>
          <ul className="space-y-1">
            {archived.map((t) => (
              <ArchivedItem key={t.id} template={t} disabled={disabled} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChannelBadge({ channel }: { channel: "email" | "sms" }) {
  return (
    <Badge className="gap-1">
      {channel === "email" ? <Mail className="w-3 h-3" /> : <MessageSquareText className="w-3 h-3" />}
      {channel === "email" ? "Email" : "Text"}
    </Badge>
  );
}

function TemplateItem({ template, disabled }: { template: TemplateRow; disabled: boolean }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, formAction, submitting] = useActionState(
    async (prev: ActionResult, fd: FormData) => {
      const res = await updateTemplate(template.id, prev, fd);
      if (res.ok) setEditing(false);
      return res;
    },
    null
  );

  if (!editing) {
    return (
      <li className="rounded-md ring-1 ring-slate-200 p-3 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-800">{template.name}</span>
          <ChannelBadge channel={template.channel} />
          <span className="flex-1" />
          {!disabled && (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => startTransition(async () => void (await setTemplateArchived(template.id, true)))}
              >
                <Archive /> Archive
              </Button>
            </>
          )}
        </div>
        {template.subject && <p className="text-xs text-slate-500">Subject: {template.subject}</p>}
        <p className="text-xs text-slate-500 whitespace-pre-wrap line-clamp-3">{template.body}</p>
      </li>
    );
  }

  return (
    <li className="rounded-md ring-1 ring-slate-300 p-3">
      <form action={formAction} className="space-y-2">
        <div className="flex items-center gap-2">
          <input name="name" defaultValue={template.name} className={inputCls} aria-label="Template name" />
          <ChannelBadge channel={template.channel} />
        </div>
        {template.channel === "email" && (
          <input
            name="subject"
            defaultValue={template.subject ?? ""}
            placeholder="Subject"
            className={inputCls}
            aria-label="Subject"
          />
        )}
        <textarea name="body" defaultValue={template.body} className={textareaCls} aria-label="Body" />
        <div className="flex items-center gap-2">
          <Button size="sm" type="submit" disabled={submitting}>
            Save
          </Button>
          <Button size="sm" variant="outline" type="button" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
        </div>
      </form>
    </li>
  );
}

function ArchivedItem({ template, disabled }: { template: TemplateRow; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-center gap-2 text-sm text-slate-400">
      <span className="line-through">{template.name}</span>
      <ChannelBadge channel={template.channel} />
      <span className="flex-1" />
      {!disabled && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(async () => void (await setTemplateArchived(template.id, false)))}
        >
          <ArchiveRestore /> Restore
        </Button>
      )}
    </li>
  );
}

function NewTemplateForm({ onDone }: { onDone: () => void }) {
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [state, formAction, submitting] = useActionState(
    async (prev: ActionResult, fd: FormData) => {
      const res = await createTemplate(prev, fd);
      if (res.ok) onDone();
      return res;
    },
    null
  );
  return (
    <form action={formAction} className="rounded-md ring-1 ring-slate-300 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input name="name" required placeholder="Template name" className={inputCls} aria-label="Template name" />
        <select
          name="channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as "email" | "sms")}
          className={selectCls}
          aria-label="Channel"
        >
          <option value="email">Email</option>
          <option value="sms">Text (SMS)</option>
        </select>
      </div>
      {channel === "email" && (
        <input name="subject" placeholder="Subject" className={inputCls} aria-label="Subject" />
      )}
      <textarea
        name="body"
        required
        placeholder="Hello {client_name}, …"
        className={textareaCls}
        aria-label="Body"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={submitting}>
          Create
        </Button>
        <Button size="sm" variant="outline" type="button" onClick={onDone}>
          Cancel
        </Button>
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

export function ReminderPolicyForm({
  policy,
  templates,
  disabled,
}: {
  policy: ReminderPolicy;
  templates: TemplateRow[];
  disabled: boolean;
}) {
  const [state, formAction, submitting] = useActionState(
    (prev: ActionResult, fd: FormData) => saveReminderPolicy(prev, fd),
    null
  );
  const activeTemplates = templates.filter((t) => !t.archived);
  return (
    <form action={formAction} className="space-y-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" defaultChecked={policy.enabled} disabled={disabled} className="rounded" />
        <span>Send automatic reminders for returns waiting on documents</span>
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-slate-500">Nudge after (days waiting)</span>
          <input
            type="number"
            name="awaiting_docs_days"
            min={0}
            max={365}
            defaultValue={policy.awaiting_docs_days}
            disabled={disabled}
            className={inputCls}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-slate-500">At most every (days)</span>
          <input
            type="number"
            name="cadence_days"
            min={1}
            max={365}
            defaultValue={policy.cadence_days}
            disabled={disabled}
            className={inputCls}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-slate-500">Channel</span>
          <select name="channel" defaultValue={policy.channel} disabled={disabled} className={`${selectCls} w-full`}>
            <option value="preferred">Client&apos;s preferred (email or text)</option>
            <option value="email">Email only</option>
            <option value="sms">Text only</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-slate-500">Template</span>
          <select
            name="template_id"
            defaultValue={policy.template_id ?? ""}
            disabled={disabled}
            className={`${selectCls} w-full`}
          >
            <option value="">Default missing-documents template</option>
            {activeTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.channel === "email" ? "email" : "text"})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-slate-400">
        Reminders go only to clients whose return sits in an &ldquo;awaiting documents&rdquo; stage
        with required checklist items still missing, and never text anyone who has opted out.
        If the chosen template&apos;s channel doesn&apos;t fit a client, the default template for
        the right channel is used.
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={disabled || submitting}>
          Save reminder policy
        </Button>
        {state?.ok && <span className="text-xs text-emerald-600">Saved.</span>}
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
