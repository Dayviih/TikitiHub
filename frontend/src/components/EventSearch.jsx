
import { useState } from "react";
import "./EventSearch.css";

function EventSearch() {
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("All Categories");

  function handleSearch(event) {
    event.preventDefault();

    console.log({
      search,
      location,
      category,
    });
  }

  return (
    <section className="event-search-section">
      <div className="event-search-container">

        <div className="event-search-heading">
          <h2>Find Your Next Event</h2>
          <p>Discover experiences happening around you.</p>
        </div>

        <form className="event-search-form" onSubmit={handleSearch}>

          <div className="search-field">
            <label htmlFor="event-name">What are you looking for?</label>
            <input
              id="event-name"
              type="text"
              placeholder="Search events..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="search-field">
            <label htmlFor="event-location">Where?</label>
            <input
              id="event-location"
              type="text"
              placeholder="Enter a location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>

          <div className="search-field">
            <label htmlFor="event-category">Category</label>
            <select
              id="event-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option>All Categories</option>
              <option>Music</option>
              <option>Technology</option>
              <option>Business</option>
              <option>Sports</option>
              <option>Education</option>
              <option>Arts & Culture</option>
            </select>
          </div>

          <button type="submit" className="search-button">
            Search Events
          </button>

        </form>
      </div>
    </section>
  );
}

export default EventSearch;
