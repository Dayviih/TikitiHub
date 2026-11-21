
import { useSearchParams } from "react-router-dom";
import { useState, useEffect } from "react";

import EventCard from "../components/EventCard";
import { getEvents } from "../services/api";

import "./Events.css";

function Events() {
  const [searchParams] = useSearchParams();

  const [events, setEvents] = useState([]);
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("default");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Retrieve events from the backend
  useEffect(() => {
    async function fetchEvents() {
      try {
        setLoading(true);
        setError("");

        const data = await getEvents();

        setEvents(data);
      } catch (err) {
        setError(err.message || "Could not load events.");
      } finally {
        setLoading(false);
      }
    }

    fetchEvents();
  }, []);

  // Filter events by name and location
  const filteredEvents = events.filter((event) => {
    const searchText = search.toLowerCase();

    const matchesSearch =
      event.name.toLowerCase().includes(searchText) ||
      event.location.toLowerCase().includes(searchText);

    return matchesSearch;
  });

  // Sort events by ticket price
  const sortedEvents = [...filteredEvents].sort((a, b) => {
    if (sortOrder === "low-high") {
      return a.price - b.price;
    }

    if (sortOrder === "high-low") {
      return b.price - a.price;
    }

    return new Date(a.date) - new Date(b.date);
  });

  return (
    <main className="events-page">
      <div className="events-header">
        <span className="section-label">
          DISCOVER EXPERIENCES
        </span>

        <h1>Explore Events</h1>

        <p>
          Find exciting events, connect with people, and create
          unforgettable memories.
        </p>
      </div>

      <div className="events-filters">
        <input
          type="text"
          placeholder="Search events or locations..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value)}
        >
          <option value="default">Sort by: Soonest</option>
          <option value="low-high">Price: Low to High</option>
          <option value="high-low">Price: High to Low</option>
        </select>
      </div>

      <div className="events-results-header">
        <h2>All Events</h2>

        <p>{sortedEvents.length} events found</p>
      </div>

      {loading ? (
        <div className="no-events">
          <p>Loading events...</p>
        </div>
      ) : error ? (
        <div className="no-events">
          <h3>Unable to load events</h3>
          <p>{error}</p>
        </div>
      ) : sortedEvents.length > 0 ? (
        <div className="events-grid">
          {sortedEvents.map((event) => (
            <EventCard event={event} key={event._id} />
          ))}
        </div>
      ) : (
        <div className="no-events">
          <h3>No events available</h3>
          <p>
            There are currently no approved upcoming events.
            Please check again later.
          </p>
        </div>
      )}
    </main>
  );
}

export default Events;
