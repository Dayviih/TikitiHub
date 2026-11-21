
import { Link } from "react-router-dom";
import "./Hero.css";

function Hero() {
  return (
    <section className="hero">
      <div className="hero-content">
        <span className="hero-label">
          YOUR NEXT EXPERIENCE STARTS HERE
        </span>

        <h1>
          Discover Events.
          <br />
          Create <span>Memories.</span>
        </h1>

        <p>
          From concerts and festivals to conferences and workshops,
          discover and book experiences worth remembering.
        </p>

        <div className="hero-actions">
          <Link to="/events" className="hero-primary-button">
            Explore Events
          </Link>

          <Link to="/register" className="hero-secondary-button">
            Become an Organizer
          </Link>
        </div>
      </div>
    </section>
  );
}

export default Hero;
