import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { Realtime, CONNECTED, DISCONNECTED, RECONNECT } from '../../../realtime/realtime.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SendHorizonal } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * Environment vars expected (add to your .env.* file or CI secrets)
 * VITE_RELAY_API_KEY=<your_api_key>
 * VITE_RELAY_SECRET=<your_secret_key>
 */

/* -------------------------------------------------------------------------------------------------
 * Relay context – one connection app‑wide
 * ------------------------------------------------------------------------------------------------*/
const RelayContext = createContext(null);

function RelayProvider({ children }) {
  const realtimeRef = useRef(null);
  const [connected, setConnected] = useState(false);

  // Connect exactly once – on mount of the provider
  useEffect(() => {
    const rt = new Realtime({
      api_key: import.meta.env.VITE_API_KEY,
      secret: import.meta.env.VITE_SECRET,
    });

    rt.init({
      debug: true
    });

    rt.on(CONNECTED, () => setConnected(true));
    rt.on(DISCONNECTED, () => setConnected(false));
    rt.on(RECONNECT, () => setConnected(false));

    rt.connect(); // 🔗 now "on mount" of the provider

    realtimeRef.current = rt;
    return () => rt.close();
  }, []);

  return (
    <RelayContext.Provider value={{ realtime: realtimeRef.current, connected }}>
      {children}
    </RelayContext.Provider>
  );
}

function useRelay() {
  const ctx = useContext(RelayContext);
  if (!ctx) throw new Error('useRelay must be used inside <RelayProvider>');
  return ctx;
}

/* -------------------------------------------------------------------------------------------------
 * Landing page – pick a room
 * ------------------------------------------------------------------------------------------------*/
function LandingPage() {
  const [room, setRoom] = useState('');
  const navigate = useNavigate();

  const joinRoom = () => {
    if (!room.trim()) return;
    navigate(`/chat/${encodeURIComponent(room.trim())}`);
  };

  return (
    <motion.div
      className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-tr from-indigo-50 to-sky-100 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <Card className="w-full max-w-md shadow-2xl">
        <CardContent className="flex flex-col gap-4 p-8">
          <h1 className="text-center text-3xl font-bold tracking-tight text-indigo-700">
            Relay Chat Demo
          </h1>
          <Input
            placeholder="Enter room name"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="text-lg"
          />
          <Button onClick={joinRoom} disabled={!room.trim()} size="lg">
            Join
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Chat page – uses the shared connection; subscribes on mount
 * ------------------------------------------------------------------------------------------------*/
function ChatPage() {
  const { room } = useParams();
  const { realtime, connected } = useRelay();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);

  // Subscribe/unsubscribe to this room when component mounts/unmounts
  useEffect(() => {
    if (!realtime) return; // connection not yet established

    const handler = (data) =>
      setMessages((prev) => [...prev, { from: 'remote', text: data.data }]);

    realtime.on(room, handler);
    return () => realtime.off(room, handler);
  }, [realtime, room]);

  const sendMessage = async () => {
    if (!input.trim() || !realtime) return;
    const ok = await realtime.publish(room, input.trim());
    if (ok) {
      setMessages((prev) => [...prev, { from: 'me', text: input.trim() }]);
      setInput('');
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between bg-indigo-600 p-4 text-white shadow-md">
        <h2 className="text-xl font-semibold">Room: {room}</h2>
        <span className={`text-sm ${connected ? 'text-emerald-300' : 'text-red-300'}`}>
          {connected ? 'Connected' : 'Offline'}
        </span>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-4 text-center text-gray-500">No messages yet – start the conversation!</p>
        )}

        {messages.map((m, i) => (
          <motion.div
            key={i}
            className={`mb-2 max-w-[75%] rounded-2xl px-4 py-2 text-base shadow ${
              m.from === 'me'
                ? 'ml-auto bg-indigo-500 text-white'
                : 'mr-auto bg-white text-gray-900'
            }`}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            {m.text}
          </motion.div>
        ))}
      </main>

      <footer className="flex items-center gap-2 border-t bg-white p-4 shadow-lg">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder={connected ? 'Type a message…' : 'Connecting to Relay…'}
          disabled={!connected}
          className="flex-1"
        />
        <Button size="icon" onClick={sendMessage} disabled={!connected || !input.trim()}>
          <SendHorizonal className="h-5 w-5" />
        </Button>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Root app
 * ------------------------------------------------------------------------------------------------*/
export default function App() {
  return (
    <Router>
      <RelayProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/chat/:room" element={<ChatPage />} />
        </Routes>
      </RelayProvider>
    </Router>
  );
}