"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { trainingPlanWorkouts } from "@/lib/seederData";
import { db, isConfigValid } from "@/lib/firebase";
import { Workout } from "@/types";
import { 
  collection, 
  onSnapshot, 
  doc, 
  updateDoc, 
  writeBatch,
  query,
  orderBy,
  DocumentData,
  where,
  limit,
  getCountFromServer
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

export default function Home() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [activePhase, setActivePhase] = useState<string>("TODAS"); // "TODAS", "FASE 1", "FASE 2", "FASE 3"
  const [onlyPending, setOnlyPending] = useState<boolean>(false);
  const [selectedWeek, setSelectedWeek] = useState<string>("TODAS");
  const [seeding, setSeeding] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string>("");

  // Firestore counter stats
  const [totalCount, setTotalCount] = useState<number>(0);
  const [completedCount, setCompletedCount] = useState<number>(0);
  const [runningCountState, setRunningCountState] = useState<number>(0);

  // Target date for workout reference (Today is Sunday, July 12, 2026)
  const todayStr = "2026-07-12";
  const todayDate = useMemo(() => {
    const [y, m, d] = todayStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, []);

  // Use Firebase or local fallback
  const useFirebase = !!(isConfigValid && !isDemoMode && db);

  // Load workouts
  useEffect(() => {
    if (!useFirebase || !db) {
      // Local Storage Demo Mode
      const stored = localStorage.getItem("ultra_sam_workouts");
      let allWorkouts: Workout[] = [];
      if (stored) {
        allWorkouts = JSON.parse(stored);
      } else {
        allWorkouts = trainingPlanWorkouts;
        localStorage.setItem("ultra_sam_workouts", JSON.stringify(trainingPlanWorkouts));
      }
      
      // Filter 10 closest upcoming workouts
      const upcoming = allWorkouts.filter((w) => w.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date));
      let sliced = upcoming.slice(0, 10);
      // Pad with past workouts if we have fewer than 10 upcoming workouts
      if (sliced.length < 10) {
        const past = allWorkouts.filter((w) => w.date < todayStr).sort((a, b) => b.date.localeCompare(a.date));
        const needed = 10 - sliced.length;
        const pastToAdd = past.slice(0, needed).reverse();
        sliced = [...pastToAdd, ...sliced];
      }
      setWorkouts(sliced);
      setLoading(false);
      return;
    }

    // Firestore Real-time listener: 10 closest upcoming workouts
    setLoading(true);
    const q = query(
      collection(db, "workouts"),
      where("date", ">=", todayStr),
      orderBy("date", "asc"),
      limit(10)
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Workout[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as Workout);
        });
        setWorkouts(list);
        setLoading(false);
      },
      (error) => {
        console.error("Firestore loading error, falling back to local:", error);
        setIsDemoMode(true);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [useFirebase]);

  // Seeding function (updates Firestore or resets LocalStorage)
  const handleSeedData = async () => {
    setSeeding(true);
    setFeedbackMsg("Sembrando entrenamientos...");

    if (!useFirebase || !db) {
      // Reset local storage
      localStorage.setItem("ultra_sam_workouts", JSON.stringify(trainingPlanWorkouts));
      setWorkouts(trainingPlanWorkouts);
      setFeedbackMsg("¡Plan de entrenamiento reiniciado en tu navegador!");
      setSeeding(false);
      setTimeout(() => setFeedbackMsg(""), 3000);
      return;
    }

    try {
      // Firestore batch upload
      const batch = writeBatch(db);
      trainingPlanWorkouts.forEach((workout) => {
        const workoutRef = doc(db, "workouts", workout.id);
        batch.set(workoutRef, workout);
      });
      await batch.commit();
      setFeedbackMsg("¡Sembrado con éxito en Cloud Firestore!");
    } catch (error) {
      console.error("Error seeding Firestore:", error);
      setFeedbackMsg("⚠️ Error al sembrar en Firestore. La base de datos es de Solo Lectura.");
    } finally {
      setSeeding(false);
      setTimeout(() => setFeedbackMsg(""), 4000);
    }
  };

  // Toggle completion status
  const handleToggleComplete = async (id: string, currentStatus: boolean) => {
    const updatedStatus = !currentStatus;

    if (!useFirebase || !db) {
      // Update local state and localStorage
      const updated = workouts.map((w) => 
        w.id === id ? { ...w, completed: updatedStatus } : w
      );
      setWorkouts(updated);
      localStorage.setItem("ultra_sam_workouts", JSON.stringify(updated));
      return;
    }

    try {
      const docRef = doc(db, "workouts", id);
      await updateDoc(docRef, { completed: updatedStatus });
    } catch (error) {
      console.error("Error updating document:", error);
      alert("⚠️ No se puede actualizar en Firestore: La base de datos está configurada como SOLO LECTURA. Los cambios no se guardarán en el servidor.");
    }
  };

  // Calculate most upcoming workout (closest to 2026-07-12 that is not completed)
  const nextWorkout = useMemo<Workout | null>(() => {
    if (workouts.length === 0) return null;

    // Filter out completed ones
    const pendingWorkouts = workouts.filter((w) => !w.completed);
    if (pendingWorkouts.length === 0) return null;

    // Group into:
    // 1. Workouts from today onwards
    // 2. Workouts in the past that are still pending
    const futurePending = pendingWorkouts.filter((w) => {
      const [y, m, d] = w.date.split("-").map(Number);
      const workoutDate = new Date(y, m - 1, d);
      return workoutDate >= todayDate;
    });

    if (futurePending.length > 0) {
      // Return the closest future pending workout (first one since sorted by date)
      return futurePending[0];
    }

    // If no future pending workouts, return the first pending one overall (usually the oldest uncompleted)
    return pendingWorkouts[0];
  }, [workouts, todayDate]);

  // Filter workouts list based on controls
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

  // Group filtered workouts by week for timeline layout
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

  // Fetch overall progress counts from Firestore (to avoid loading all 168 docs)
  useEffect(() => {
    if (!db || !useFirebase) return;

    const fetchCounts = async () => {
      try {
        const coll = collection(db, "workouts");
        const totalSnap = await getCountFromServer(coll);
        const completedSnap = await getCountFromServer(query(coll, where("completed", "==", true)));
        const runningSnap = await getCountFromServer(
          query(coll, where("type", "==", "running"), where("completed", "==", true))
        );
        
        setTotalCount(totalSnap.data().count);
        setCompletedCount(completedSnap.data().count);
        setRunningCountState(runningSnap.data().count);
      } catch (err) {
        console.error("Error fetching stats counts:", err);
      }
    };

    fetchCounts();
  }, [workouts, useFirebase]); // Refetch counts when the local list snapshot updates

  // Progress metrics calculation
  const stats = useMemo(() => {
    if (!useFirebase) {
      // In local demo mode, we need to read from the FULL local storage list to show correct overall progress
      const stored = localStorage.getItem("ultra_sam_workouts");
      const allWorkouts: Workout[] = stored ? JSON.parse(stored) : trainingPlanWorkouts;
      const total = allWorkouts.length;
      if (total === 0) return { total: 0, completed: 0, percent: 0, runningCount: 0 };
      const completed = allWorkouts.filter((w) => w.completed).length;
      const percent = Math.round((completed / total) * 100);
      const running = allWorkouts.filter((w) => w.type === "running" && w.completed).length;
      
      return {
        total,
        completed,
        percent,
        runningCount: running
      };
    }

    // In Firestore mode, use our aggregated count states
    const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    return {
      total: totalCount,
      completed: completedCount,
      percent,
      runningCount: runningCountState
    };
  }, [workouts, useFirebase, totalCount, completedCount, runningCountState]);

  // List of weeks for the filter dropdown
  const weeksList = useMemo<number[]>(() => {
    const weeks = new Set<number>();
    workouts.forEach((w) => weeks.add(w.week));
    return Array.from(weeks).sort((a, b) => a - b);
  }, [workouts]);

  // Helper to determine CSS variable for workout types
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

  // ------------------ missing configuration page view ------------------
  if (!isConfigValid && !isDemoMode) {
    return (
      <div className="setup-container glass-card fade-in">
        <h2>Conectar con Firebase Firestore</h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: "1rem" }}>
          Esta aplicación utiliza Cloud Firestore para almacenar y sincronizar el estado de tus entrenamientos. Sigue estos pasos para configurarlo:
        </p>
        
        <div className="setup-steps">
          <div className="setup-step">
            <span className="step-number">1</span>
            <div>
              <strong>Crear Proyecto de Firebase:</strong>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                Ve a la <a href="https://console.firebase.google.com/" target="_blank" style={{ color: "#38bdf8", textDecoration: "underline" }}>Consola de Firebase</a>, crea un proyecto y activa Cloud Firestore.
              </p>
            </div>
          </div>

          <div className="setup-step">
            <span className="step-number">2</span>
            <div>
              <strong>Configurar Variables de Entorno:</strong>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                Crea un archivo llamado <code>.env.local</code> en la raíz del proyecto y añade tus credenciales:
              </p>
              <pre className="code-block">
{`NEXT_PUBLIC_FIREBASE_API_KEY=tu_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=tu_proyecto.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=tu_proyecto_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=tu_proyecto.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=tu_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=tu_app_id`}
              </pre>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "2rem" }}>
          <button 
            className="btn btn-primary" 
            style={{ width: "100%", "--accent-color": "#38bdf8", "--glow-color": "rgba(56, 189, 248, 0.2)" } as React.CSSProperties}
            onClick={() => window.location.reload()}
          >
            Refrescar y Verificar Configuración
          </button>
          
          <button 
            className="btn btn-secondary" 
            style={{ width: "100%" }}
            onClick={() => setIsDemoMode(true)}
          >
            Usar Modo Demo Local (Sin Servidor)
          </button>
        </div>
      </div>
    );
  }

  // ------------------ main dashboard view ------------------
  return (
    <div className="app-container fade-in">
      {/* Header section with profile */}
      <header className="header-section">
        <div className="title-container">
          <h1>Plan de Entrenamiento 10K Sub-40</h1>
          <p>
            Entrenamiento estratégico de 6 meses para ruta con altimetría severa.
          </p>
          <div style={{ marginTop: "0.75rem", display: "flex", gap: "1rem" }}>
            <Link href="/workouts" className="filter-btn active" style={{ display: "inline-flex", textDecoration: "none", alignItems: "center", gap: "0.5rem" }}>
              📋 Historial Completo (Ver Todos)
            </Link>
          </div>
          {isDemoMode ? (
            <div style={{ display: "inline-block", background: "rgba(234, 179, 8, 0.15)", border: "1px solid rgba(234, 179, 8, 0.3)", padding: "0.25rem 0.75rem", borderRadius: "8px", fontSize: "0.8rem", color: "#fbbf24", marginTop: "0.5rem" }}>
              ⚠️ Ejecutando en <strong>Modo Demo Local</strong>. Los cambios se guardan en este navegador.
            </div>
          ) : (
            <div style={{ display: "inline-block", background: "rgba(56, 189, 248, 0.15)", border: "1px solid rgba(56, 189, 248, 0.3)", padding: "0.25rem 0.75rem", borderRadius: "8px", fontSize: "0.8rem", color: "#38bdf8", marginTop: "0.5rem" }}>
              🔒 Base de Datos conectada: **Firestore (Solo Lectura)**.
            </div>
          )}
        </div>
        
        {/* Athlete Profile Widget */}
        <div className="glass-card profile-card">
          <h3>Perfil del Atleta</h3>
          <div className="profile-grid">
            <div className="profile-item">
              <span className="label">Edad / Peso</span>
              <span className="value">30 años / 143 lbs</span>
            </div>
            <div className="profile-item">
              <span className="label">Récord en Ruta</span>
              <span className="value">51:00 (5:06/km)</span>
            </div>
            <div className="profile-item">
              <span className="label">Objetivo Meta</span>
              <span className="value">Sub-40 min (4:00/km)</span>
            </div>
            <div className="profile-item">
              <span className="label">Fecha Inicio</span>
              <span className="value">8 de Julio, 2026</span>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Progress Bar */}
      <section className="glass-card" style={{ padding: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div>
            <h3 style={{ fontSize: "1.1rem", fontWeight: "700" }}>Progreso de la Preparación</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
              Has completado {stats.completed} de {stats.total} entrenamientos ({stats.runningCount} sesiones de running)
            </p>
          </div>
          <span style={{ fontSize: "1.5rem", fontWeight: "800", color: "#38bdf8" }}>{stats.percent}%</span>
        </div>
        <div style={{ background: "rgba(255,255,255,0.05)", height: "12px", borderRadius: "6px", overflow: "hidden" }}>
          <div style={{ background: "linear-gradient(to right, #38bdf8, #a855f7)", height: "100%", width: `${stats.percent}%`, borderRadius: "6px", transition: "width 0.5s ease" }} />
        </div>
      </section>

      {/* Featured next workout (STICKY AT TOP) */}
      <section className="featured-workout-container">
        {nextWorkout ? (
          <div 
            className="glass-card featured-workout-card" 
            style={getWorkoutColorStyles(nextWorkout.type)}
          >
            <span className="featured-badge">Siguiente Entrenamiento</span>
            <div className="featured-title">
              {nextWorkout.title}
              <span className="type-badge">{nextWorkout.type === "running" ? "Running" : nextWorkout.type === "fuerza" ? "Fuerza" : nextWorkout.type === "caminata" ? "Caminata" : nextWorkout.type === "movilidad" ? "Movilidad" : "Descanso"}</span>
            </div>
            
            <div className="featured-meta">
              <span>
                📅 <strong>Fecha:</strong> {parseWorkoutDate(nextWorkout.date).dayName} {parseWorkoutDate(nextWorkout.date).dayNum} de {parseWorkoutDate(nextWorkout.date).monthName}
              </span>
              <span>
                🏃‍♂️ <strong>Semana:</strong> {nextWorkout.week}
              </span>
              <span>
                ⛰️ <strong>Fase:</strong> {nextWorkout.phase.split(":")[0]}
              </span>
            </div>
            
            <p className="featured-desc">{nextWorkout.description}</p>
            
            <div className="featured-actions">
              <button 
                className="btn btn-primary" 
                onClick={() => handleToggleComplete(nextWorkout.id, nextWorkout.completed)}
              >
                ✓ Marcar como Completado
              </button>
              
              <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                Basado en tu fecha actual ({todayStr})
              </span>
            </div>
          </div>
        ) : (
          <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
            <h3 style={{ marginBottom: "0.5rem" }}>¡Sin entrenamientos pendientes!</h3>
            <p style={{ color: "var(--text-secondary)" }}>
              No tienes más entrenamientos programados o has completado todo el plan. ¡Felicidades!
            </p>
          </div>
        )}
      </section>

      {/* Main timeline listing and filters */}
      <section style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: "700" }}>Próximos 10 Entrenamientos</h2>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Fecha actual: {todayStr}</span>
        </div>
        <div className="controls-bar">
          <div className="filters-group">
            {["TODAS", "FASE 1", "FASE 2", "FASE 3"].map((phase) => (
              <button
                key={phase}
                className={`filter-btn ${activePhase === phase ? "active" : ""}`}
                onClick={() => {
                  setActivePhase(phase);
                  setSelectedWeek("TODAS"); // Reset week on phase change to avoid mismatches
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
              {weeksList.map((week) => (
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

        {loading ? (
          <div className="loader"></div>
        ) : groupedWorkouts.length === 0 ? (
          <div className="glass-card empty-placeholder">
            <h3>No se encontraron entrenamientos</h3>
            <p>Ajusta tus filtros o presiona "Sembrar Plan" en la parte inferior para inicializar el plan de 6 meses.</p>
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
                    const isUpcoming = nextWorkout && nextWorkout.id === workout.id;
                    
                    return (
                      <div 
                        key={workout.id} 
                        className={`glass-card workout-item ${workout.completed ? "completed-card" : ""} ${isUpcoming ? "fade-in" : ""}`}
                        style={{
                          ...getWorkoutColorStyles(workout.type),
                          ...(isUpcoming ? { 
                            boxShadow: "0 0 15px var(--item-color-glow)",
                            borderColor: "var(--item-color)"
                          } : {})
                        }}
                      >
                        {/* Day / Date column */}
                        <div className="workout-date-badge">
                          <span className="day-name">{dateInfo.dayName}</span>
                          <span className="day-num">{dateInfo.dayNum}</span>
                          <span className="day-month">{dateInfo.monthName}</span>
                        </div>

                        {/* Title & Description column */}
                        <div className="workout-details">
                          <div className="workout-details-header">
                            <span className="workout-item-title">{workout.title}</span>
                            <span className="type-badge">{workout.type === "running" ? "Running" : workout.type === "fuerza" ? "Fuerza" : workout.type === "caminata" ? "Caminata" : workout.type === "movilidad" ? "Movilidad" : "Descanso"}</span>
                            {isUpcoming && (
                              <span style={{ fontSize: "0.7rem", color: "var(--item-color)", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", background: "rgba(255,255,255,0.05)", padding: "0.15rem 0.4rem", borderRadius: "4px", border: "1px solid" } as React.CSSProperties}>
                                Próximo
                              </span>
                            )}
                          </div>
                          <p className="workout-desc">{workout.description}</p>
                        </div>

                        {/* Complete action checkbox column */}
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
      </section>

      {/* Seeder/Settings Footer */}
      <footer className="glass-card admin-section">
        <h3>Panel de Control de Datos</h3>
        <p>
          {useFirebase ? (
            "⚠️ La base de datos de Firestore está configurada como SOLO LECTURA. Para poder sembrar o guardar cambios permanentemente, debes usar el Modo Demo Local."
          ) : (
            "Puedes reiniciar el plan a su estado original (todos los días sin completar) en el almacenamiento local de tu navegador."
          )}
        </p>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
          <button 
            className="btn btn-secondary" 
            onClick={handleSeedData}
            disabled={seeding}
            style={{ borderColor: "rgba(56, 189, 248, 0.4)", color: "#38bdf8" }}
          >
            {seeding ? "Procesando..." : "Sembrar / Reiniciar Plan de 6 Meses"}
          </button>

          {isConfigValid && (
            <button 
              className="btn btn-secondary" 
              onClick={() => setIsDemoMode(!isDemoMode)}
            >
              {isDemoMode ? "🔌 Cambiar a Firestore (Solo Lectura)" : "🔌 Cambiar a Modo Demo (Escritura Local)"}
            </button>
          )}
        </div>
        {feedbackMsg && (
          <div style={{ fontSize: "0.9rem", color: "#38bdf8", fontWeight: "600", transition: "all 0.3s" }}>
            {feedbackMsg}
          </div>
        )}
      </footer>
    </div>
  );
}
