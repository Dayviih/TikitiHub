
const API_BASE_URL = "http://localhost:3000";

// Retrieve all approved upcoming events
export async function getEvents() {
  const response = await fetch(`${API_BASE_URL}/events`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to retrieve events.");
  }

  return data.events;
}

// Retrieve one event using its MongoDB ID
export async function getEventById(id) {
  const response = await fetch(`${API_BASE_URL}/events/${id}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to retrieve event.");
  }

  return data.event;
}

// Create a ticket booking
export async function createBooking(bookingDetails) {
  const response = await fetch(`${API_BASE_URL}/bookings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bookingDetails),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to create booking.");
  }

  return data.booking;
}
