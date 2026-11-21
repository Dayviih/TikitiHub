
import "./WhyChooseUs.css";

const benefits = [
  {
    id: 1,
    title: "Easy Event Discovery",
    description:
      "Find concerts, conferences, festivals and other exciting experiences in one place.",
  },
  {
    id: 2,
    title: "Simple Booking",
    description:
      "Book your tickets through a straightforward process without unnecessary complications.",
  },
  {
    id: 3,
    title: "Secure Payments",
    description:
      "Enjoy a secure booking experience with convenient payment options.",
  },
  {
    id: 4,
    title: "Digital Tickets",
    description:
      "Access your tickets digitally and make event entry easier.",
  },
];

function WhyChooseUs() {
  return (
    <section className="why-choose-us">
      <div className="why-header">
        <span className="section-label">THE TIKITIHUB EXPERIENCE</span>

        <h2>Why Choose TikitiHub?</h2>

        <p>
          Everything you need to discover, book and enjoy
          unforgettable experiences.
        </p>
      </div>

      <div className="benefits-grid">
        {benefits.map((benefit) => (
          <div className="benefit-card" key={benefit.id}>
            <h3>{benefit.title}</h3>
            <p>{benefit.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default WhyChooseUs;
