"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Link from "next/link";
import { trainingPlanWorkouts } from "@/lib/seederData";
import { db, isConfigValid } from "@/lib/firebase";
import { Workout } from "@/types";
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  startAfter, 
  getDocs, 
  doc, 
  updateDoc,
  DocumentData,
  QueryDocumentSnapshot
} from "firebase/firestore";

// Helper to parse YYYY-MM-DD date safely in local timezone
const parseWorkoutDate = (dateStr: string) => {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  
  return {
    dayName: dayNames[date.getDay()],
    dayNum: day,
    monthName: monthNames[date.getMonth()],
    rawDate: date
  };
};

interface GroupedWeek {
  week: number;
  phase: string;
  month: string;
  items: Workout[];
}

export default function WorkoutsHistory() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  
  // Filtering controls
  const [activePhase, setActivePhase] = useState<string>("TODAS");
  const [selectedWeek, setSelectedWeek] = useState<string>("TODAS");
  const [onlyPending, setOnlyPending] = useState<boolean>(false);

  // Pagination states for Firestore
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData, DocumentData> | null>(null);
  
  // Pagination states for Local Storage
  const [localIndex, setLocalIndex] = useState<number>(10);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const useFirebase = !!(isConfigValid && !isDemoMode && db);

  // Initial Load
  useEffect(() => {
    // Check if demo mode was set on Home page via localStorage
    const demoSetting = localStorage.getItem("ultra_sam_demo_mode");
    if (demoSetting === "true" || !isConfigValid) {
      setIsDemoMode(true);
    }
  }, []);

  const loadInitialWorkouts = useCallback(async () => {
    setLoading(true);
    if (!useFirebase || !db) {
      // Demo Mode initial load
      const stored = localStorage.getItem("ultra_sam_workouts");
      let all: Workout[] = [];
      if (stored) {
        all = JSON.parse(stored);
      } else {
        all = trainingPlanWorkouts;
        localStorage.setItem("ultra_sam_workouts", JSON.stringify(trainingPlanWorkouts));
      }
      setWorkouts(all.slice(0, 10));
      setLocalIndex(10);
      setHasMore(all.length > 10);
      setLoading(false);
      return;
    }

    try {
      const q = query(
        collection(db, "workouts"),
        orderBy("date", "asc"),
        limit(10)
      );
      const snapshot = await getDocs(q);
      
      const list: Workout[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as Workout);
      });
      
      setWorkouts(list);
      setHasMore(snapshot.docs.length === 10);
      if (snapshot.docs.length > 0) {
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
      } else {
        setLastDoc(null);
      }
    } catch (err) {
      console.error("Error loading Firestore workouts, entering Demo Mode:", err);
      setIsDemoMode(true);
    } finally {
      setLoading(false);
    }
  }, [useFirebase]);

  useEffect(() => {
    loadInitialWorkouts();
  }, [loadInitialWorkouts]);

  // Load next batch (10 items)
  const loadMoreWorkouts = async () => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);

    if (!useFirebase) {
      // Local Storage Demo Mode Pagination
      const stored = localStorage.getItem("ultra_sam_workouts");
      const all: Workout[] = stored ? JSON.parse(stored) : trainingPlanWorkouts;
      const nextIndex = localIndex + 10;
      
      // Delay slightly for natural feel of spinner loading
      setTimeout(() => {
        setWorkouts(all.slice(0, nextIndex));
        setLocalIndex(nextIndex);
        setHasMore(all.length > nextIndex);
        setLoadingMore(false);
      }, 500);
      return;
    }

    // Firestore Pagination
    if (!lastDoc || !db) {
      setHasMore(false);
      setLoadingMore(false);
      return;
    }

    try {
      const q = query(
        collection(db, "workouts"),
        orderBy("date", "asc"),
        startAfter(lastDoc),
        limit(10)
      );
      const snapshot = await getDocs(q);
      
      const list: Workout[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as Workout);
      });

      if (list.length > 0) {
        setWorkouts((prev) => [...prev, ...list]);
        setHasMore(snapshot.docs.length === 10);
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error("Error loading more from Firestore:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Setup intersection observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          loadMoreWorkouts();
        }
      },
      { threshold: 0.1 }
    );

    const currentSentinel = sentinelRef.current;
    if (currentSentinel) {
      observer.observe(currentSentinel);
    }

    return () => {
      if (currentSentinel) {
        observer.unobserve(currentSentinel);
      }
    };
  }, [hasMore, loading, loadingMore, lastDoc, localIndex]);

  // Toggle completion status
  const handleToggleComplete = async (id: string, currentStatus: boolean) => {
    const updatedStatus = !currentStatus;

    // Update in-memory workouts list immediately for responsiveness
    setWorkouts((prev) => 
      prev.map((w) => w.id === id ? { ...w, completed: updatedStatus } : w)
    );

    // Save to database
    if (!useFirebase || !db) {
      const stored = localStorage.getItem("ultra_sam_workouts");
      if (stored) {
        const all: Workout[] = JSON.parse(stored);
        const updated = all.map((w) => 
          w.id === id ? { ...w, completed: updatedStatus } : w
        );
        localStorage.setItem("ultra_sam_workouts", JSON.stringify(updated));
      }
      return;
    }

    try {
      const docRef = doc(db, "workouts", id);
      await updateDoc(docRef, { completed: updatedStatus });
    } catch (error) {
      console.error("Error updating document:", error);
      alert("⚠️ No se puede actualizar en Firestore: La base de datos es de Solo Lectura. Regresando estado anterior.");
      // Rollback
      setWorkouts((prev) => 
        prev.map((w) => w.id === id ? { ...w, completed: currentStatus } : w)
      );
    }
  };

  // Toggle demo mode locally
  const handleToggleMode = () => {
    const nextMode = !isDemoMode;
    setIsDemoMode(nextMode);
    localStorage.setItem("ultra_sam_demo_mode", String(nextMode));
    // Trigger clean reload of data
    setWorkouts([]);
    setLastDoc(null);
    setLocalIndex(10);
  };

  // Filter workouts list based on UI controls
  const filteredWorkouts = useMemo(() => {
    return workouts.filter((w) => {
      // Filter by phase
      if (activePhase !== "TODAS") {
        if (activePhase === "FASE 1" && !w.phase.includes("FASE 1")) return false;
        if (activePhase === "FASE 2" && !w.phase.includes("FASE 2")) return false;
        if (activePhase === "FASE 3" && !w.phase.includes("FASE 3")) return false;
      }

      // Filter by week
      if (selectedWeek !== "TODAS" && w.week !== Number(selectedWeek)) {
        return false;
      }

      // Filter by status
      if (onlyPending && w.completed) {
        return false;
      }

      return true;
    });
  }, [workouts, activePhase, selectedWeek, onlyPending]);

  // Group filtered workouts by week
  const groupedWorkouts = useMemo<GroupedWeek[]>(() => {
    const groups: { [key: number]: GroupedWeek } = {};
    filteredWorkouts.forEach((w) => {
      if (!groups[w.week]) {
        groups[w.week] = {
          week: w.week,
          phase: w.phase,
          month: w.month,
          items: []
        };
      }
      groups[w.week].items.push(w);
    });
    return Object.values(groups).sort((a, b) => a.week - b.week);
  }, [filteredWorkouts]);

  // Full list of 24 weeks for week selector (independent of currently loaded items)
  const fullWeeksList = useMemo<number[]>(() => {
    return Array.from({ length: 24 }, (_, i) => i + 1);
  }, []);

  const getWorkoutColorStyles = (type: string) => {
    switch (type) {
      case "running":
        return {
          "--item-color": "var(--color-running)",
          "--item-color-glow": "var(--color-running-glow)"
        } as React.CSSProperties;
      case "fuerza":
        return {
          "--item-color": "var(--color-fuerza)",
          "--item-color-glow": "var(--color-fuerza-glow)"
        } as React.CSSProperties;
      case "caminata":
        return {
          "--item-color": "var(--color-caminata)",
          "--item-color-glow": "var(--color-caminata-glow)"
        } as React.CSSProperties;
      case "movilidad":
        return {
          "--item-color": "var(--color-movilidad)",
          "--item-color-glow": "var(--color-movilidad-glow)"
        } as React.CSSProperties;
      default:
        return {
          "--item-color": "var(--color-descanso)",
          "--item-color-glow": "var(--color-descanso-glow)"
        } as React.CSSProperties;
    }
  };

  return (
    <div className="app-container fade-in">
      <header style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Link href="/" className="filter-btn" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}>
            ← Dashboard
          </Link>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end", marginTop: "0.5rem" }}>
          <div>
            <h1 style={{ fontSize: "2rem", fontWeight: "800", background: "linear-gradient(to right, #38bdf8, #a855f7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Historial de Entrenamientos
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
              Explora y gestiona los 168 entrenamientos del plan de preparación de 6 meses.
            </p>
          </div>
          <span style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", padding: "0.4rem 0.8rem", borderRadius: "8px", fontSize: "0.85rem", color: isDemoMode ? "#fbbf24" : "#38bdf8" }}>
            {isDemoMode ? "⚠️ Modo Demo Local" : "🔒 Firestore (Solo Lectura)"}
          </span>
        </div>
      </header>

      {/* Filter and control bar */}
      <section style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div className="controls-bar">
          <div className="filters-group">
            {["TODAS", "FASE 1", "FASE 2", "FASE 3"].map((phase) => (
              <button
                key={phase}
                className={`filter-btn ${activePhase === phase ? "active" : ""}`}
                onClick={() => {
                  setActivePhase(phase);
                  setSelectedWeek("TODAS");
                }}
              >
                {phase}
              </button>
            ))}
          </div>

          <div className="selector-group">
            <label style={{ fontSize: "0.85rem", color: "var(--text-secondary)", fontWeight: "600" }}>
              Semana:
            </label>
            <select
              className="select-dropdown"
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(e.target.value)}
            >
              <option value="TODAS">Ver Todas</option>
              {fullWeeksList.map((week) => (
                <option key={week} value={String(week)}>Semana {week}</option>
              ))}
            </select>

            <button
              className={`filter-btn ${onlyPending ? "active" : ""}`}
              style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}
              onClick={() => setOnlyPending(!onlyPending)}
            >
              🎯 Solo pendientes
            </button>
          </div>
        </div>

        {/* Workouts list */}
        {loading ? (
          <div className="loader"></div>
        ) : groupedWorkouts.length === 0 ? (
          <div className="glass-card empty-placeholder">
            <h3>No hay entrenamientos cargados</h3>
            <p>
              {useFirebase ? (
                "La base de datos está vacía. Regresa al Dashboard para sembrar los datos."
              ) : (
                "No hay entrenamientos que coincidan con los filtros aplicados."
              )}
            </p>
          </div>
        ) : (
          <div className="workouts-timeline">
            {groupedWorkouts.map((group) => (
              <div key={group.week} className="week-group">
                <div className="week-header">
                  <h2>Semana {group.week}</h2>
                  <span className="week-phase">{group.phase}</span>
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                  📅 {group.month}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {group.items.map((workout) => {
                    const dateInfo = parseWorkoutDate(workout.date);
                    return (
                      <div 
                        key={workout.id}
                        className={`glass-card workout-item ${workout.completed ? "completed-card" : ""}`}
                        style={getWorkoutColorStyles(workout.type)}
                      >
                        <div className="workout-date-badge">
                          <span className="day-name">{dateInfo.dayName}</span>
                          <span className="day-num">{dateInfo.dayNum}</span>
                          <span className="day-month">{dateInfo.monthName}</span>
                        </div>

                        <div className="workout-details">
                          <div className="workout-details-header">
                            <span className="workout-item-title">{workout.title}</span>
                            <span className="type-badge">
                              {workout.type === "running" ? "Running" : workout.type === "fuerza" ? "Fuerza" : workout.type === "caminata" ? "Caminata" : workout.type === "movilidad" ? "Movilidad" : "Descanso"}
                            </span>
                          </div>
                          <p className="workout-desc">{workout.description}</p>
                        </div>

                        <div className="checkbox-container">
                          <label className="round-checkbox">
                            <input 
                              type="checkbox"
                              checked={workout.completed}
                              onChange={() => handleToggleComplete(workout.id, workout.completed)}
                            />
                            <span className="checkmark"></span>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Scroll Sentinel for Infinite Scroll */}
        {hasMore && !loading && (
          <div ref={sentinelRef} style={{ display: "flex", justifyContent: "center", padding: "1.5rem 0" }}>
            <div className="loader" style={{ margin: 0, width: "30px", height: "30px", borderWidth: "2px" }}></div>
          </div>
        )}

        {!hasMore && workouts.length > 0 && (
          <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            ✨ Has llegado al final de tu plan de entrenamiento de 6 meses (168 días cargados).
          </div>
        )}
      </section>

      {/* Mode Switcher Admin panel */}
      {isConfigValid && (
        <footer className="glass-card admin-section" style={{ marginTop: "1rem" }}>
          <p>
            {isDemoMode ? (
              "Estás en Modo Demo Local (los cambios se guardan localmente). Si deseas leer de Firestore, haz clic en el botón de abajo."
            ) : (
              "Estás en modo Firestore. La base de datos es de Solo Lectura. Para poder interactuar y guardar cambios, cambia a Modo Demo Local."
            )}
          </p>
          <button className="btn btn-secondary" onClick={handleToggleMode}>
            {isDemoMode ? "🔌 Usar Firestore (Solo Lectura)" : "🔌 Usar Modo Demo Local (Escritura en Navegador)"}
          </button>
        </footer>
      )}
    </div>
  );
}
