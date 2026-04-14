import foodOrdering from "./food_ordering.json";
import grandEstanciaTicketing from "./grand_estancia_ticketing.json";
import minimal from "./minimal.json";
import podcastInterview from "./podcast_interview.json";

export const EXAMPLES = [
  { id: "minimal", name: "Minimal", json: minimal },
  { id: "food_ordering", name: "Food Ordering (Simple)", json: foodOrdering },
  { id: "podcast_interview", name: "Podcast Interview", json: podcastInterview },
  { id: "grand_estancia_ticketing", name: "Grand Estancia Ticketing (Gemini Live)", json: grandEstanciaTicketing },
];
