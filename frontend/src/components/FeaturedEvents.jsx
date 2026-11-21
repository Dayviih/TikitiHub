
import { useState, useEffect } from "react";

import EventCard from "./EventCard";
import { getEvents } from "../services/api";

import "./FeaturedEvents.css";

function FeaturedEvents() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchFeaturedEvents() {
      try {
        setLoading(true);

        const data = await getEvents();

        // Display the first three upcoming events
        setEvents(data.slice(0, 3));
      } catch (err) {
        setError(err.message || "Could not load featured events.");
      } finally {
        setLoading(false);
      }
    }

    fetchFeaturedEvents();
  }, []);

  return (
    <section className="featured-events">
      <div className="featured-events-header">
        <div>
          <span className="section-label">DON'T MISS OUT</span>

          <h2>Featured Events</h2>

          <p>
            Discover some of the most exciting upcoming events.
          </p>
        </div>
      </div>

      {loading ? (
        <p>Loading featured events...</p>
      ) : error ? (
        <p>{error}</p>
      ) : events.length > 0 ? (
        <div className="events-grid">
          {events.map((event) => (
            <EventCard event={event} key={event._id} />
          ))}
        </div>
      ) : (
        <p>
          No upcoming events available at the moment.
        </p>
      )}
    </section>
  );
}

export default FeaturedEvents;
