export interface Workout {
  id: string;
  date: string;
  title: string;
  description: string;
  type: "running" | "fuerza" | "caminata" | "movilidad" | "descanso";
  phase: string;
  month: string;
  week: number;
  completed: boolean;
}
