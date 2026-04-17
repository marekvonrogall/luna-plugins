import { Tracer, type LunaUnload } from "@luna/core";
import { observe } from "@luna/lib";

export const { trace } = Tracer("[Comité]");
export const unloads = new Set<LunaUnload>();

const COMITÉ = "comité-controls";
const STAR_COUNT = 5;

let currentRating = 0;

function renderCurrentState(): void {
  const wrapper = document.getElementById(COMITÉ);
  if (!wrapper) return;

  for (const node of wrapper.querySelectorAll<HTMLButtonElement>(
    "button[data-rating]",
  )) {
    const rating = Number(node.dataset.rating);
    const filled = rating <= currentRating;

    node.textContent = filled ? "★" : "☆";
    node.style.opacity = filled ? "1" : "0.45";
    node.ariaPressed = String(filled);
  }
}

function createStarButton(rating: number): HTMLButtonElement {
  const button = document.createElement("button");
  button.dataset.rating = String(rating);
  button.style.padding = "0";
  button.style.margin = "0";
  button.style.cursor = "pointer";
  button.style.fontSize = "18px";
  button.style.opacity = "0.45";
  button.style.transform = "none";
  button.textContent = "☆";

  button.addEventListener("click", async () => {
    try {
      button.disabled = true;
      // Apply Rating
      currentRating = currentRating === rating ? 0 : rating;
      console.log(`Track rating is: ${currentRating} stars!`);
      renderCurrentState();
    } catch (error) {
      trace.msg.err.withContext("Failed to update rating")(error as Error);
    } finally {
      button.disabled = false;
    }
  });

  return button;
}

function loadComité(): void {
  if (document.getElementById(COMITÉ)) return;

  const trackInfo = document.querySelector('[data-test="track-info"]');
  if (!trackInfo) return;

  const trackContent = trackInfo.querySelector('div[class*="_trackContent_"]');
  if (!trackContent) return;

  const wrapper = document.createElement("div");
  wrapper.id = COMITÉ;
  wrapper.style.display = "inline-flex";
  wrapper.style.gap = "5px";

  for (let rating = 1; rating <= STAR_COUNT; rating++) {
    wrapper.appendChild(createStarButton(rating));
  }

  trackContent.appendChild(wrapper);
  renderCurrentState();
}

function watchUI(): void {
  observe(unloads, "#footerPlayer", () => {
    loadComité();
  });
  loadComité();
}

async function init(): Promise<void> {
  watchUI();

  // const initialTrack = await MediaItem.fromPlaybackContext();
  // console.log(initialTrack);
}

init().catch((error) => {
  trace.msg.err.withContext("Comité plugin failed to initialize")(
    error as Error,
  );
});

unloads.add(() => {
  document.getElementById(COMITÉ)?.remove();
});
