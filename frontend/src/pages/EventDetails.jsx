
import { useParams, Link, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";

import { getEventById } from "../services/api";

import "./EventDetails.css";

function EventDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [quantity, setQuantity] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Retrieve the selected event from the backend
  useEffect(() => {
    async function fetchEvent() {
      try {
        setLoading(true);
        setError("");

        const data = await getEventById(id);

        setEvent(data);
      } catch (err) {
        setError(err.message || "Could not load event.");
      } finally {
        setLoading(false);
      }
    }

    fetchEvent();
  }, [id]);

  // Calculate available tickets
  const availableTickets = event
    ? Math.max(
        0,
        event.capacity -
          (event.ticketsSold || 0) -
          (event.ticketsReserved || 0)
      )
    : 0;

  const ticketPrice = event ? event.price : 0;
  const totalPrice = ticketPrice * quantity;

  // Format the event date
  const formattedDate = event
    ? new Date(event.date).toLocaleString("en-KE", {
        dateStyle: "long",
        timeStyle: "short",
      })
    : "";

  function handleQuantityChange(e) {
    const value = Number(e.target.value);

    if (
      Number.isInteger(value) &&
      value >= 1 &&
      value <= Math.min(10, availableTickets)
    ) {
      setQuantity(value);
    }
  }

  function handleBooking() {
    if (!event || availableTickets < 1) {
      return;
    }

    navigate("/checkout", {
      state: {
        event,
        quantity,
      },
    });
  }

  // Loading state
  if (loading) {
    return (
      <main className="event-not-found">
        <h2>Loading Event...</h2>
        <p>Please wait while we retrieve the event details.</p>
      </main>
    );
  }

  // Error or event not found
  if (error || !event) {
    return (
      <main className="event-not-found">
        <h2>Event Not Found</h2>

        <p>
          {error || "Sorry, we couldn't find this event."}
        </p>

        <Link to="/events">Explore Events</Link>
      </main>
    );
  }

  return (
    <main className="event-details-page">
      <Link to="/events" className="back-to-events">
        ← Back to Events
      </Link>

      <div className="event-details-container">

        {/* Event Image */}
        <div className="event-details-image">
          <img src={event.image} alt={event.name} />
        </div>

        {/* Event Information */}
        <div className="event-details-content">
          <h1>{event.name}</h1>

          <p className="event-details-description">
            {event.description}
          </p>

          <div className="event-information">
            <div>
              <span>Date</span>
              <strong>{formattedDate}</strong>
            </div>

            <div>
              <span>Location</span>
              <strong>{event.location}</strong>
            </div>

            <div>
              <span>Price per ticket</span>
              <strong>
                KES {ticketPrice.toLocaleString("en-KE")}
              </strong>
            </div>

            <div>
              <span>Available Tickets</span>
              <strong>{availableTickets}</strong>
            </div>
          </div>

          {/* Ticket Booking */}
          <div className="ticket-booking">
            {availableTickets > 0 ? (
              <>
                <label htmlFor="ticket-quantity">
                  Number of Tickets
                </label>

                <input
                  id="ticket-quantity"
                  type="number"
                  min="1"
                  max={Math.min(10, availableTickets)}
                  value={quantity}
                  onChange={handleQuantityChange}
                />

                <div className="booking-total">
                  <span>Total Amount</span>

                  <strong>
                    KES {totalPrice.toLocaleString("en-KE")}
                  </strong>
                </div>

                <button
                  className="book-ticket-button"
                  type="button"
                  onClick={handleBooking}
                >
                  Proceed to Booking
                </button>
              </>
            ) : (
              <p>No tickets are currently available.</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default EventDetails;
