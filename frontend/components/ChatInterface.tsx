"use client";

import { useRef, useState, useEffect } from "react";
import { sendChatMessage } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";

interface Props {
  driverCode: string;
  currentLap: number;
  isRaceLoaded: boolean;
}

export default function ChatInterface({
  driverCode,
  currentLap,
  isRaceLoaded,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading || !isRaceLoaded) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: input.trim(),
      lap: currentLap,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const response = await sendChatMessage(
        userMsg.content,
        driverCode,
        currentLap,
        messages
      );
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: response.reply,
        lap: currentLap,
        tools_used: response.tools_used,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${e.message}`,
          lap: currentLap,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <h3 className="text-sm font-semibold mb-2 text-muted-foreground">
        Race Engineer Chat
      </h3>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-3 scrollbar-thin min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">
            {isRaceLoaded
              ? 'Ask your race engineer anything — "Should we pit?", "What\'s the gap to P1?"'
              : "Load a race to start chatting"}
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border"
              }`}
            >
              {msg.lap && (
                <span className="block text-[10px] opacity-60 mb-1">
                  Lap {msg.lap}
                </span>
              )}
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.tools_used && msg.tools_used.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {msg.tools_used.map((tool, j) => (
                    <span
                      key={j}
                      className="inline-block rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-lg px-3 py-2 text-sm">
              <span className="animate-pulse text-muted-foreground">
                Analyzing race data...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={
            isRaceLoaded
              ? "Ask your race engineer..."
              : "Load a race first"
          }
          disabled={!isRaceLoaded || loading}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!isRaceLoaded || loading || !input.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
