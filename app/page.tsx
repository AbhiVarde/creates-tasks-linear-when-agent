"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { VercelMark } from "@/components/vercel-mark";

const MAX_INPUT_LENGTH = 500;
const AGENT_NAME = `an agent that creates tasks in linear when I ask it to`;

type Session = {
  url: string;
  sandboxName: string;
  sessionId: string | null;
  continuationToken: string | null;
  turnCount: number;
};

function getText(parts: { type: string }[]) {
  const part = parts.find(
    (p): p is { type: "text"; text: string } => p.type === "text",
  );
  return part?.text ?? "";
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    let cancelled = false;

    fetch("/api/run-agent", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) {
          setConnectError(data.error ?? "couldn't start this agent, try reloading");
          return;
        }
        setSession({
          url: data.url,
          sandboxName: data.sandboxName,
          sessionId: null,
          continuationToken: null,
          turnCount: 0,
        });
      })
      .catch(() => {
        if (!cancelled) setConnectError("couldn't reach the agent runtime");
      })
      .finally(() => {
        if (!cancelled) setConnecting(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function reviveAndRetry(input: RequestInfo | URL, init?: RequestInit) {
    const res = await fetch(input, init);
    if (res.status !== 409) return res;

    const reviveRes = await fetch("/api/run-agent", { method: "POST" });
    const revived = await reviveRes.json().catch(() => null);
    if (!revived?.ok) return res;

    const freshSession: Session = {
      url: revived.url,
      sandboxName: revived.sandboxName,
      sessionId: null,
      continuationToken: null,
      turnCount: 0,
    };
    sessionRef.current = freshSession;
    setSession(freshSession);

    if (!init?.body) return res;
    const body = JSON.parse(init.body as string);
    const retryBody = JSON.stringify({
      ...body,
      url: freshSession.url,
      sessionId: null,
      continuationToken: null,
      turnCount: 0,
    });
    return fetch(input, { ...init, body: retryBody });
  }

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agent-chat",
        fetch: reviveAndRetry,
        prepareSendMessagesRequest({ messages }) {
          const last = messages[messages.length - 1];
          const text = last ? getText(last.parts as any) : "";
          const s = sessionRef.current;
          return {
            body: {
              url: s?.url,
              message: text,
              sessionId: s?.sessionId ?? null,
              continuationToken: s?.continuationToken ?? null,
              turnCount: s?.turnCount ?? 0,
            },
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    onData: (part: any) => {
      if (part.type === "data-session") {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                sessionId: part.data.sessionId,
                continuationToken: part.data.continuationToken,
                turnCount: prev.turnCount + 1,
              }
            : prev,
        );
      }
    },
  });

  const submitting = status === "streaming" || status === "submitted";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || !session || submitting) return;
    setInput("");
    sendMessage({ text: trimmed });
  }

  const lastMessage = messages[messages.length - 1];
  const lastAssistantText =
    lastMessage?.role === "assistant" ? getText(lastMessage.parts as any) : "";
  const showThinking =
    status === "submitted" ||
    (status === "streaming" && lastMessage?.role === "assistant" && !lastAssistantText.trim());

  return (
    <div className="flex h-full min-h-screen flex-col">
      <header className="fixed top-0 left-0 z-30 w-full px-6 py-4">
        <span className="flex items-center gap-2">
          <VercelMark />
          <span className="text-sm font-medium text-muted-foreground">/</span>
          <span className="truncate font-mono text-sm font-medium tracking-tight">
            {AGENT_NAME}
          </span>
        </span>
      </header>

      <Conversation className="flex-1 pt-16">
        <ConversationContent className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 pb-4">
          {connecting && (
            <p className="font-mono text-xs text-muted-foreground">waking up your agent...</p>
          )}
          {connectError && (
            <p className="font-mono text-xs text-red-400/80">{connectError}</p>
          )}

          {messages.map((m) => {
            const text = getText(m.parts as any);
            if (!text && m.role === "assistant") return null;
            return (
              <Message from={m.role as "user" | "assistant"} key={m.id}>
                <MessageContent
                  className={
                    m.role === "user"
                      ? "bg-black! px-3! py-1.5! font-mono text-sm text-white rounded-lg! shadow-sm"
                      : "bg-transparent p-0 text-sm"
                  }
                >
                  {m.role === "assistant" ? <MessageResponse>{text}</MessageResponse> : text}
                </MessageContent>
              </Message>
            );
          })}

          {showThinking && (
            <Message from="assistant">
              <MessageContent className="bg-transparent p-0 font-mono text-xs text-muted-foreground">
                <Shimmer duration={1.2} className="font-mono text-sm">
                  thinking...
                </Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto w-full max-w-2xl p-4">
        <form onSubmit={onSubmit} className="w-full space-y-2">
          <div className="relative">
            <Textarea
              placeholder={connecting ? "connecting..." : "message this agent..."}
              value={input}
              maxLength={MAX_INPUT_LENGTH}
              disabled={!session}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_LENGTH))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              className="min-h-28 resize-none rounded-md border-0 bg-black/20 px-3 py-2.5 pr-14 font-mono text-sm shadow-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span className="pointer-events-none absolute right-3 bottom-2.5 font-mono text-[11px] tabular-nums text-muted-foreground/60">
              {input.length}/{MAX_INPUT_LENGTH}
            </span>
          </div>
          <Button
            type="submit"
            disabled={!session || submitting || !input.trim()}
            className="w-full cursor-pointer"
          >
            {submitting && <Spinner className="size-4" />}
            <span className="animate-in fade-in duration-300">
              {submitting ? "sending..." : "send"}
            </span>
          </Button>
        </form>
        <a
          href="https://tryeve.abhivarde.in"
          target="_blank"
          rel="noopener noreferrer"
          className="mx-auto mt-4 block w-fit cursor-pointer font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          built with tryeve
        </a>
      </div>
    </div>
  );
}
