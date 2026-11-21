
import { Link } from "react-router-dom";
import "./CategorySection.css";

const categories = [
  {
    id: 1,
    name: "Music",
    description: "Concerts and live performances",
  },
  {
    id: 2,
    name: "Technology",
    description: "Tech events and innovation",
  },
  {
    id: 3,
    name: "Business",
    description: "Networking and conferences",
  },
  {
    id: 4,
    name: "Sports",
    description: "Sports and competitions",
  },
  {
    id: 5,
    name: "Education",
    description: "Workshops and learning",
  },
  {
    id: 6,
    name: "Arts & Culture",
    description: "Art and cultural experiences",
  },
];

function CategorySection() {
  return (
    <section className="category-section">
      <div className="category-header">
        <div>
          <span className="section-label">EXPLORE YOUR INTERESTS</span>
          <h2>Browse by Category</h2>
          <p>Find events that match what you love.</p>
        </div>
      </div>

      <div className="category-grid">
        {categories.map((category) => (
          <Link
            to={`/events?category=${encodeURIComponent(category.name)}`}
            className="category-card"
            key={category.id}
          >
            <h3>{category.name}</h3>
            <p>{category.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default CategorySection;
