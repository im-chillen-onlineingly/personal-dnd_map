import { useEffect, useState, useRef } from 'react';
import Peer, { DataConnection } from 'peerjs';

import { getCookie, setCookie } from '@/app/utils/cookie';
import { AppSnapshot, SnapshotUpdate } from '@/app/map/types';

export function useHostPeerSession(mapName: string) {
  const [peer, setPeer] = useState<Peer | null>(null);
  const [connections, setConnections] = useState<DataConnection[]>([]);
  const [peerId, setPeerId] = useState<string>('');
  const [gameState, setGameState] = useState<AppSnapshot | undefined>(undefined);
  const connectionsRef = useRef<DataConnection[]>([]);
  const [messageCount, setMessageCount] = useState(0);

  useEffect(() => {
    let id = getCookie(`peerId-${mapName}`);
    if (!id) {
      id = `${mapName}-${Math.random().toString(36).substring(2, 15)}`;
      setCookie(`peerId-${mapName}`, id);
    }
    setPeerId(id);
  }, [mapName]);

  useEffect(() => {
    if (!peerId) return;
    const p = new Peer(peerId);
    setPeer(p);

    p.on('open', (id) => {
      console.log('Host peer ID:', id);
    });

    p.on('connection', (conn) => {
      setConnections((prev) => {
        const updated = [...prev, conn];
        connectionsRef.current = updated;
        return updated;
      });
      console.log('New connection from', conn.peer);

      // send the current game state immediately upon connection
      conn.send({ type: 'snapshot', snapShot: gameState } as SnapshotUpdate);

      conn.on('data', (data) => {
        console.log(`Received from ${conn.peer}:`, data);
        // Handle incoming data per connection here
      });

      // this is what happens when a peer disconnects nicely
      conn.on('close', () => {
        setConnections((prev) => {
          const updated = prev.filter((c) => c.peer !== conn.peer);
          connectionsRef.current = updated;
          return updated;
        });
        console.log(`Connection to ${conn.peer} closed.`);
      });

      conn.on('iceStateChanged', () => {
        // this doesnt make sense but the last state is "connected" when the connection is closed
        // its likely that the last event isn't handled or missed
        // this is typically when someone closes the browser tab or loses connection
        if (conn.peerConnection.connectionState === 'connected') {
          console.log(`Connection to ${conn.peer} is not open.`);
          setConnections((prev) => {
            const updated = prev.filter((c) => c.peer !== conn.peer);
            connectionsRef.current = updated;
            return updated;
          });
        } else {
          console.log(`Connection to ${conn.peer} is open or starting.`);
        }
      });

      conn.on('error', (err) => {
        console.error(`Connection error with ${conn.peer}:`, err);
      });
    });

    p.on('disconnected', () => {
      console.log('Host peer disconnected');
    });

    return () => {
      p.destroy();
      setConnections([]);
      connectionsRef.current = [];
    };
  }, [peerId]);

  // Broadcast data to all connected peers
  const broadcastData = (data: unknown) => {
    if (
      typeof data === 'object' &&
      data !== null &&
      'type' in data &&
      (data as { type: string }).type === 'snapshot'
    ) {
      setMessageCount((c) => c + 1);
      const snap = data as SnapshotUpdate;
      setGameState(snap.snapShot);
      console.log('message count', messageCount);
      console.log('ref count', connectionsRef.current.length);
    }

    connectionsRef.current.forEach((conn) => {
      if (conn.open) conn.send(data);
    });
  };

  // Send data to a specific peer
  const sendDataToPeer = (peerId: string, data: unknown) => {
    const conn = connectionsRef.current.find((c) => c.peer === peerId);
    if (conn && conn.open) {
      conn.send(data);
    }
  };

  // Get all connected peer IDs
  const connectedPeerIds = connections.map((c) => c.peer);

  return {
    peer,
    connections,
    connectedPeerIds,
    broadcastData,
    sendDataToPeer,
    peerId,
  };
}
