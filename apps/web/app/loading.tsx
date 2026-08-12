export default function Loading() {
  return (
    <section aria-label="正在加载" className="page">
      <div className="page-heading">
        <div className="page-heading-copy" style={{ width: "20rem" }}>
          <div className="skeleton" style={{ height: "1rem", width: "45%" }} />
          <div className="skeleton" style={{ height: "3rem", marginTop: ".7rem" }} />
        </div>
      </div>
      <div className="dashboard-grid">
        <div className="panel dashboard-card skeleton" />
        <div className="panel dashboard-card skeleton" />
        <div className="panel dashboard-card skeleton" />
      </div>
    </section>
  );
}
