
import { useLocation, Link } from "react-router-dom";
import { useState } from "react";
import { createBooking } from "../services/api";

import "./Checkout.css";

function Checkout() {
  const location = useLocation();

  const { event, quantity } = location.state || {};

  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [mpesaPhone, setMpesaPhone] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(null);

  if (!event || !quantity) {
    return (
      <main className="checkout-empty">
        <h2>No Booking Found</h2>
        <p>Please select an event before proceeding to checkout.</p>
        <Link to="/events">Explore Events</Link>
      </main>
    );
  }

  const ticketPrice = Number(event.price);
  const totalPrice = ticketPrice * quantity;

  async function handleCheckout(e) {
    e.preventDefault();

    setError("");

    const normalizedPhone = phone.replace(/[\s-]/g, "");

    const normalizedMpesaPhone = mpesaPhone.replace(/[\s-]/g, "");

    const phonePattern = /^(?:\+254|254|0)(?:7|1)\d{8}$/;

    if (!phonePattern.test(normalizedPhone)) {
      setError("Please enter a valid Kenyan phone number.");
      return;
    }

    if (!phonePattern.test(normalizedMpesaPhone)) {
      setError("Please enter a valid M-Pesa phone number.");
      return;
    }

    try {
      setLoading(true);

      const newBooking = await createBooking({
        eventId: event._id,
        customerName,
        customerEmail: email,
        customerPhone: normalizedPhone,
        quantity: Number(quantity),
      });

      setBooking(newBooking);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Display the reservation after successful booking creation
  if (booking) {
    return (
      <main className="checkout-page">
        <div className="checkout-header">
          <span className="section-label">RESERVATION CREATED</span>
          <h1>Your booking is reserved!</h1>
          <p>Your tickets are temporarily held while you complete payment.</p>
        </div>

        <section className="checkout-summary">
          <h2>Booking Details</h2>

          <p>Booking Reference: <strong>{booking.bookingReference}</strong></p>
          <p>Event: {booking.event}</p>
          <p>Tickets: {booking.quantity}</p>

          <h3>
            Total: KES {Number(booking.totalAmount).toLocaleString("en-KE")}
          </h3>

          <p>
            Reservation expires:{" "}
            {new Date(booking.expiresAt).toLocaleString("en-KE")}
          </p>

          <p>
            Your reservation is not a confirmed ticket until payment is verified.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="checkout-page">
      <div className="checkout-header">
        <span className="section-label">COMPLETE YOUR BOOKING</span>
        <h1>Checkout</h1>
        <p>Review your booking and enter your contact information.</p>
      </div>

      <div className="checkout-container">

        <section className="checkout-form-section">
          <h2>Customer Information</h2>

          <form onSubmit={handleCheckout}>
            <div className="checkout-input-group">
              <label htmlFor="customer-name">Full Name</label>
              <input
                id="customer-name"
                type="text"
                placeholder="Enter your full name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
              />
            </div>

            <div className="checkout-input-group">
              <label htmlFor="customer-email">Email Address</label>
              <input
                id="customer-email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="checkout-input-group">
              <label htmlFor="customer-phone">Phone Number</label>
              <input
                id="customer-phone"
                type="tel"
                placeholder="e.g. 0712345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>

            <div className="payment-method-section">
              <h2>Payment Method</h2>

              <div className="payment-option">
                <strong>M-Pesa</strong>
                <small>Pay using your M-Pesa account</small>
              </div>

              <div className="checkout-input-group mpesa-phone-group">
                <label htmlFor="mpesa-phone">M-Pesa Phone Number</label>

                <input
                  id="mpesa-phone"
                  type="tel"
                  placeholder="e.g. 0712345678"
                  value={mpesaPhone}
                  onChange={(e) => setMpesaPhone(e.target.value)}
                  required
                />

                <small>
                  This number will receive the M-Pesa payment prompt.
                </small>
              </div>
            </div>

            {error && (
              <p className="mpesa-error">{error}</p>
            )}

            <button
              type="submit"
              className="checkout-submit-button"
              disabled={loading}
            >
              {loading ? "Creating Reservation..." : "Reserve Tickets"}
            </button>
          </form>
        </section>

        <section className="checkout-summary">
          <h2>Booking Summary</h2>

          <img src={event.image} alt={event.name} />

          <h3>{event.name}</h3>

          <p>{new Date(event.date).toLocaleString("en-KE")}</p>
          <p>{event.location}</p>

          <div className="checkout-summary-row">
            <span>Ticket Price</span>
            <strong>
              KES {ticketPrice.toLocaleString("en-KE")}
            </strong>
          </div>

          <div className="checkout-summary-row">
            <span>Number of Tickets</span>
            <strong>{quantity}</strong>
          </div>

          <div className="checkout-total">
            <span>Total Amount</span>
            <strong>
              KES {totalPrice.toLocaleString("en-KE")}
            </strong>
          </div>
        </section>

      </div>
    </main>
  );
}

export default Checkout;
