import { NavLink, Link } from "react-router-dom";
import "./Navbar.css";

function Navbar() {
  return (
    <nav className="navbar">
      {/* Logo */}
      <Link to="/" className="navbar-logo">
        Tikiti<span>Hub</span>
        <small>.</small>
      </Link>

      {/* Navigation links */}
      <div className="navbar-links">
        <NavLink to="/" end>
          Home
        </NavLink>

        <NavLink to="/events">
          Explore Events
        </NavLink>

        <NavLink to="/about">
          About Us
        </NavLink>
      </div>

      {/* Authentication buttons */}
      <div className="navbar-actions">
        <Link to="/login" className="login-link">
          Sign In
        </Link>

        <Link to="/register" className="register-button">
          Get Started
        </Link>
      </div>
    </nav>
  );
}

export default Navbar;