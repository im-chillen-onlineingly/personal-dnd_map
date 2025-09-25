'use client';

import { useSearchParams } from 'next/navigation';
import { House } from 'lucide-react';
import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import ConnectedPeersButton from '../components/ConnectedPeersButton';
import { useHostPeerSession } from '../hooks/rtc/useHostMap';
import { getFromLocalStorage, saveToLocalStorage } from '../utils/localStorage';
import CharacterPanel from './components/CharacterPanel';
import HelpDialog from './components/HelpDialog';
import InitiativePanel from './components/InitiativePanel';
import MapGrid from './components/MapGrid';
import ObjectPanel from './components/ObjectPanel';
import SaveMapCard from './components/SaveMapCard';
import UtilityPanel from './components/UtilityPanel';
import { MapProvider, useMapContext } from './context/MapContext';
import useHotkeys from './hooks/useHotKeys';
import type { AppSnapshot, Terrain } from './types';
import { getId } from './utils/id';
import { BUILTIN_TERRAIN } from './utils/terrain';
import LoadingMapDialog from './components/LoadingMapDialog';
import { Button } from '../components/ui/button';

const MapContainer = () => {
  // Map configuration
  const { state, actions, handlers } = useMapContext();
  const {
    characters,
    terrain,
    isDragging,
    dragMode,
    lastCell,
    selectedTool,
    currentTurn,
    customObjects,
    mode,
  } = state;

  const {
    setTerrain,
    setIsDragging,
    setDragMode,
    setLastCell,
    setCurrentTurn,
    setShowHelp,
    setMode,
    setPaintTool,
  } = actions;

  const { handleNextTurn, undo, redo, saveSnapshot, takeSnapshot, restoreSnapshot } = handlers;

  const searchParams = useSearchParams();
  const mapName = searchParams.get('mapName') ?? 'Shadow Over Orlando';
  useHotkeys({
    mode,
    setMode,
    setPaintTool,
    undo,
    redo,
    handleNextTurn,
    setCurrentTurn,
    setShowHelp,
  });

  const { peer, connections, broadcastData } = useHostPeerSession(mapName);

  const [mapIsLoaded, setMapIsLoaded] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(true);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const handleLoadMap = useCallback(() => {
    setShowLoadDialog(true);
    const loadedMap = getFromLocalStorage<AppSnapshot>(mapName);
    if (loadedMap) {
      restoreSnapshot(loadedMap);
    }
  }, [mapName, restoreSnapshot]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowLoadDialog(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [showLoadDialog]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSaveDialog(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [showSaveDialog]);

  useEffect(() => {
    if (!mapIsLoaded) {
      setShowLoadDialog(true);
      handleLoadMap();
      setMapIsLoaded(true);
    }
  }, [mapIsLoaded, handleLoadMap]);

  // ---- undo / redo snapshot
  // snapshot helper
  function commit(mutator: () => void) {
    saveSnapshot();
    mutator();
  }

  // broadcast snapshots on every state change
  useEffect(() => {
    const snapShot = takeSnapshot();
    broadcastData({ type: 'snapshot', snapShot });
  }, [characters, terrain, currentTurn]);

  // Helper functions

  const isCustomObjectType = (t: string) =>
    !BUILTIN_TERRAIN.has(t) && customObjects.some((o) => o.id === t);

  // find the object meta by id ("chest", "maomao", …)
  const getCustomObject = (typeId: string) => customObjects.find((o) => o.id === typeId);

  const hasTerrainAt = (type: string, x: number, y: number, terrain: Terrain[]) =>
    terrain.some((t) => t.type === type && t.x === x && t.y === y);

  // add exactly one terrain of this type at (x,y), replacing any existing terrain **of any type** at that cell
  const addTerrainAt = (type: string, x: number, y: number) => {
    setTerrain((prev) => {
      // remove any terrain occupying this cell (if you want to replace only same-type, filter by type instead)
      const withoutCell = prev.filter((t) => !(t.x === x && t.y === y));
      return [...withoutCell, { id: getId(), type, x, y }];
    });
  };

  const removeTerrainAt = (type: string, x: number, y: number) => {
    setTerrain((prev) => prev.filter((t) => !(t.type === type && t.x === x && t.y === y)));
  };

  // Left-down or Right-down on a cell
  const paintSnap = useRef(false);

  const handleCellMouseDown = (e: MouseEvent, x: number, y: number) => {
    if (selectedTool === 'select') return;
    e.preventDefault();
    e.stopPropagation();

    if (!paintSnap.current) {
      saveSnapshot();
      paintSnap.current = true;
    }

    const tool = selectedTool;

    // Decide mode once at drag start:
    // - Right click => erase
    // - Left click => toggle: if cell already has this tool => erase, else paint
    const exists = hasTerrainAt(tool, x, y, terrain);
    const mode: 'paint' | 'erase' = e.button === 2 ? 'erase' : exists ? 'erase' : 'paint';

    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragMode(mode);
    setLastCell({ x, y });

    if (mode === 'paint') addTerrainAt(tool, x, y);
    else removeTerrainAt(tool, x, y);
  };

  // When dragging across cells with the mouse held down
  const handleCellMouseEnter = (_e: MouseEvent, x: number, y: number) => {
    if (!isDragging || !dragMode || selectedTool === 'select') return;

    if (lastCell && lastCell.x === x && lastCell.y === y) return; // skip repeats

    const tool = selectedTool;
    if (dragMode === 'paint') {
      if (!hasTerrainAt(tool, x, y, terrain)) addTerrainAt(tool, x, y);
    } else {
      if (hasTerrainAt(tool, x, y, terrain)) removeTerrainAt(tool, x, y);
    }

    setLastCell({ x, y });
  };

  // Remember the last paint subtool the user picked

  const handleSaveMap = () => {
    setShowSaveDialog(true);
    const snapShot = takeSnapshot();
    saveToLocalStorage(mapName, snapShot);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="px-4 pt-3 pb-1">
        <h1 className="text-lg font-semibold flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="mr-2"
            onClick={() => (window.location.href = '/')}
          >
            <House />
          </Button>
          {mapName}
        </h1>
      </header>

      <main className="flex-1 flex gap-4 p-4">
        {/* Left Panel - Tools */}
        <ConnectedPeersButton
          connections={connections}
          sendData={broadcastData}
          peer={peer}
          mapName={mapName}
        />
        <div className="w-64 flex-shrink-0 space-y-4">
          <ObjectPanel />

          <CharacterPanel />

          <UtilityPanel />
        </div>

        {/* Center - Map */}
        <MapGrid
          isCustomObjectType={isCustomObjectType}
          getCustomObject={getCustomObject}
          handleCellMouseDown={handleCellMouseDown}
          handleCellMouseEnter={handleCellMouseEnter}
          commit={commit}
          paintSnap={paintSnap}
        />

        {/* Right Panel - Initiative */}

        <div className="w-64 flex-shrink-0 flex flex-col gap-4">
          <InitiativePanel />

          <SaveMapCard handleSaveMap={handleSaveMap} handleLoadMap={handleLoadMap} />
        </div>

        {/* Help button + dialog (replaces always-on instructions) */}
        <HelpDialog />

        <LoadingMapDialog
          isOpen={showLoadDialog}
          title="Loading Map..."
          body="Please wait while the map is being loaded."
        />

        <LoadingMapDialog
          isOpen={showSaveDialog}
          title="Saving Map..."
          body="Please wait while the map is being saved."
        />
      </main>
    </div>
  );
};

const MapWithContext = () => (
  <MapProvider>
    <MapContainer />
  </MapProvider>
);

export default MapWithContext;
