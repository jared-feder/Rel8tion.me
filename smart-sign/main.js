import { CHECKIN_PATHS } from "./config.js";
import { getEventById, touchEvent } from "./api.js";
import { submitCheckin } from "./checkin.js";
import { renderEventPage } from "./renderer.js";
import { setState, state } from "./state.js";

function validPath(path) {
  return Object.values(CHECKIN_PATHS).includes(path) ? path : CHECKIN_PATHS.BUYER;
}

async function init() {
  const root = document.getElementById("smart-sign-event-root");
  if (!root) return;

  const params = new URLSearchParams(window.location.search);
  const eventId = params.get("event");
  const path = validPath(params.get("path"));

  if (!eventId) {
    root.innerHTML = "<div style='padding:20px;font-family:sans-serif;'>Missing event query parameter.</div>";
    return;
  }

  setState({ loading: true, checkinPath: path });

  try {
    const event = await getEventById(eventId);
    if (!event) throw new Error("Event not found");

    setState({ event, loading: false });
    await touchEvent(event.id);

    renderEventPage({
      root,
      event,
      selectedPath: state.checkinPath,
      onSubmit: async (values) => submitCheckin(state.checkinPath, event.id, values)
    });
  } catch (error) {
    root.innerHTML = `<div style='padding:20px;font-family:sans-serif;'>${error.message}</div>`;
  }
}

init();
