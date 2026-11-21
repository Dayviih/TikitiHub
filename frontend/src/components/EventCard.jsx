
import { Link } from "react-router-dom";

import "./EventCard.css";

function EventCard({ event }) {
  const formattedDate = new Date(event.date).toLocaleDateString(
    "en-KE",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  );

  const formattedPrice = `KES ${event.price.toLocaleString("en-KE")}`;

  return (
    <article className="event-card">
      <div className="event-card-image">
        <img src={event.image} alt={event.name} />
      </div>

      <div className="event-card-content">
        <p className="event-date">{formattedDate}</p>

        <h3>{event.name}</h3>

        <p className="event-location">{event.location}</p>

        <div className="event-card-footer">
          <span className="event-price">{formattedPrice}</span>

          <Link
            to={`/events/${event._id}`}
            className="event-book-button"
          >
            View Details
          </Link>
        </div>
      </div>
    </article>
  );
}

export default EventCard;
