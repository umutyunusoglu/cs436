#!/usr/bin/env python3
# /// script
# dependencies = ["graphviz"]
# ///

import graphviz

# ── Colours ───────────────────────────────────────────────────────────────────
C = {
    "cf":      "#8C4FFF",
    "s3":      "#3F8624",
    "lambda":  "#E8701A",
    "rds":     "#3B48CC",
    "apigw":   "#E8701A",
    "eb":      "#C7131F",
    "sm":      "#DD344C",
    "cw":      "#E7157B",
    "sns":     "#E7157B",
    "ext":     "#37474F",
    "border":  "#232F3E",
}

def nd(label, fill, fc="white", shape="box", w="1.7", h="0.65"):
    return dict(
        label=label, fillcolor=fill, fontcolor=fc,
        shape=shape, style="filled,rounded",
        fontname="Helvetica", fontsize="11",
        width=w, height=h,
        color=C["border"], penwidth="1.5",
    )

dot = graphviz.Digraph(
    graph_attr={
        "rankdir":   "TB",
        "splines":   "true",
        "compound":  "true",
        "newrank":   "true",
        "nodesep":   "0.55",
        "ranksep":   "0.85",
        "fontname":  "Helvetica",
        "fontsize":  "14",
        "bgcolor":   "white",
        "pad":       "0.9",
        "label":     "Gold & Silver Price Tracker — AWS Architecture",
        "labelloc":  "b",
    }
)

# ── External actors (no cluster) ──────────────────────────────────────────────
dot.node("browser", **nd("Browser\n(React SPA)", C["ext"], shape="ellipse", w="1.4"))
dot.node("tiingo",  **nd("Tiingo API\n(XAU / XAG)", C["ext"], shape="ellipse", w="1.4"))

# ── AWS-managed services outside VPC ─────────────────────────────────────────
dot.node("ws_api",   **nd("WebSocket\nAPI Gateway", C["apigw"]))
dot.node("rest_api", **nd("REST\nAPI Gateway", C["apigw"]))
dot.node("eb_fetch", **nd("EventBridge\nevery 5 min", C["eb"]))
dot.node("eb_train", **nd("EventBridge\nSun, Tue, Fri 06:00", C["eb"]))

# ── Shared storage + secrets (outside VPC) ─────────────────────────────────
dot.node("m_bucket", **nd("S3  model-artifacts", C["s3"]))
dot.node("sm_rds",   **nd("Secret:\nrds-credentials", C["sm"]))
dot.node("sm_api",   **nd("Secret:\nmetals-api-key", C["sm"]))

# ── CloudFront cluster ────────────────────────────────────────────────────────
with dot.subgraph(name="cluster_cf") as c:
    c.attr(
        label="CloudFront  (single public entry point)",
        style="filled", fillcolor="#F3EEFF",
        color=C["cf"], penwidth="2.5",
        fontname="Helvetica Bold", fontsize="12", fontcolor=C["cf"],
    )
    c.node("cf",         **nd("CloudFront\n/* · /api/* · /ws", C["cf"]))
    c.node("web_bucket", **nd("S3  static-web", C["s3"]))

# ── VPC wrapper ───────────────────────────────────────────────────────────────
with dot.subgraph(name="cluster_vpc") as vpc:
    vpc.attr(
        label="VPC  (2 Availability Zones)",
        style="filled", fillcolor="#FAFAFA",
        color=C["border"], penwidth="2.5",
        fontname="Helvetica Bold", fontsize="12", fontcolor=C["border"],
    )

    # Private subnet (NAT) ─────────────────────────────────────────────────────
    with vpc.subgraph(name="cluster_private_nat") as priv_nat:
        priv_nat.attr(
            label="🔒  Private Subnets\n(internet-routable via NAT Gateway)",
            style="filled", fillcolor="#EBF5FF",
            color="#0972D3", penwidth="2",
            fontname="Helvetica", fontsize="11", fontcolor="#0972D3",
        )
        priv_nat.node("api_handler", **nd("api-handler λ\n512 MB · 60 s", C["lambda"]))
        priv_nat.node("pf",          **nd("price-fetcher λ\n512 MB · 60 s", C["lambda"]))
        priv_nat.node("invoker",     **nd("model-invoker λ\n512 MB · 60 s", C["lambda"]))
        priv_nat.node("trainer",     **nd("model-trainer λ\n512 MB · 10 min", C["lambda"]))

    # Private isolated subnet ──────────────────────────────────────────────────
    with vpc.subgraph(name="cluster_private") as priv:
        priv.attr(
            label="🔒  Private Isolated Subnets\n(no internet route)",
            style="filled", fillcolor="#E6FAF5",
            color="#148A8A", penwidth="2",
            fontname="Helvetica", fontsize="11", fontcolor="#148A8A",
        )
        priv.node("rds", **nd("RDS PostgreSQL\nt3.micro", C["rds"]))

    

# ── Monitoring cluster ────────────────────────────────────────────────────────
with dot.subgraph(name="cluster_mon") as mon:
    mon.attr(
        label="MonitoringStack",
        style="filled", fillcolor="#FFF0F5",
        color=C["cw"], penwidth="1.5",
        fontname="Helvetica", fontsize="11", fontcolor=C["cw"],
    )
    mon.node("cw",  **nd("CloudWatch\nDashboard + Alarms", C["cw"]))
    mon.node("sns", **nd("SNS  alarms topic", C["sns"]))

# ── Edges ─────────────────────────────────────────────────────────────────────
E  = dict(fontname="Helvetica", fontsize="10", color=C["border"], penwidth="1.4")
EP = dict(fontname="Helvetica", fontsize="10", color="#7c3aed",   penwidth="1.2", style="dashed")
MN = dict(color="#aaaaaa", penwidth="1.0", style="dashed", arrowhead="none")

# Browser → CloudFront
dot.edge("browser", "cf",         **E)
dot.edge("cf",      "web_bucket", label=" /*",     **E)
dot.edge("cf",      "rest_api",   label=" /api/*", **E)
dot.edge("cf",      "ws_api",     label=" /ws",    **E)

# API Gateways → api-handler
dot.edge("rest_api", "api_handler", **E)
dot.edge("ws_api",   "api_handler", **E)
dot.edge("pf",       "ws_api",      label=" push", **E)

# Ingestion
dot.edge("eb_fetch", "pf",  **E)
dot.edge("tiingo",   "pf",  **E)
dot.edge("pf",       "rds", **E)

# API handler → private
dot.edge("api_handler", "invoker", label=" invoke", **E)
dot.edge("api_handler", "rds",                      **E)

# ML
dot.edge("eb_train", "trainer",   **E)
dot.edge("invoker",  "rds",       **E)
dot.edge("invoker",  "m_bucket",  **E)
dot.edge("trainer",  "rds",       **E)
dot.edge("trainer",  "m_bucket",  **E)



# Secrets Manager routing (from Lambdas via NAT Gateway)
for src in ["pf", "api_handler", "invoker", "trainer"]:
    dot.edge(src, "sm_rds", **EP)
dot.edge("pf", "sm_api", **EP)

# Monitoring (dashed grey, no arrowhead)
for src in ["pf", "api_handler", "invoker", "trainer", "rds"]:
    dot.edge(src, "cw", **MN)
dot.edge("cw", "sns", color=C["cw"], penwidth="1.4", fontname="Helvetica")

dot.render("architecture-new", cleanup=True)
print("architecture-new.pdf written.")
dot.render("architecture-new", format="png", cleanup=True)
print("architecture-new.png written.")