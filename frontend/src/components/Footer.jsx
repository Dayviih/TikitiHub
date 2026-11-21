
import { Link } from "react-router-dom";
import "./Footer.css";

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-container">

        {/* Brand */}
        <div className="footer-brand">
          <Link to="/" className="footer-logo">
            Tikiti<span>Hub</span>.
          </Link>

          <p>
            Discover amazing experiences, book your tickets
            and create memories with TikitiHub.
          </p>
        </div>

        {/* Quick Links */}
        <div className="footer-column">
          <h3>Explore</h3>

          <Link to="/">Home</Link>
          <Link to="/events">Discover Events</Link>
          <Link to="/about">About Us</Link>
        </div>

        {/* Organizers */}
        <div className="footer-column">
          <h3>For Organizers</h3>

          <Link to="/register">Become an Organizer</Link>
          <Link to="/login">Organizer Login</Link>
        </div>

        {/* Support */}
        <div className="footer-column">
          <h3>Support</h3>

          <Link to="/about">Contact Us</Link>
          <Link to="/about">Help Center</Link>
        </div>

      </div>

      {/* Bottom Footer */}
      <div className="footer-bottom">
        <p>
          © {new Date().getFullYear()} TikitiHub. All rights reserved.
        </p>

        <p>Made for unforgettable experiences.</p>
      </div>
    </footer>
  );
}

export default Footer;
