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
    "alb":     "#8C4FFF",
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
        "splines":   "curved",
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
dot.node("goldapi",  **nd("goldapi.io\n(XAU / XAG)", C["ext"], shape="ellipse", w="1.4"))

# ── AWS-managed services outside VPC ─────────────────────────────────────────
dot.node("ws_api",   **nd("WebSocket\nAPI Gateway", C["apigw"]))
dot.node("eb_fetch", **nd("EventBridge\nevery 5 min", C["eb"]))
dot.node("eb_train", **nd("EventBridge\nSunday 03:00 UTC", C["eb"]))

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

    # Public subnet ────────────────────────────────────────────────────────────
    with vpc.subgraph(name="cluster_public") as pub:
        pub.attr(
            label="🌐  Public Subnets\n(internet-routable via IGW)",
            style="filled", fillcolor="#EBF5FF",
            color="#0972D3", penwidth="2",
            fontname="Helvetica", fontsize="11", fontcolor="#0972D3",
        )
        pub.node("alb",         **nd("ALB  (HTTP :80)", C["alb"]))
        pub.node("api_handler", **nd("api-handler λ\n256 MB · 15 s", C["lambda"]))
        pub.node("pf",          **nd("price-fetcher λ\n128 MB · 30 s", C["lambda"]))

    # Private isolated subnet ──────────────────────────────────────────────────
    with vpc.subgraph(name="cluster_private") as priv:
        priv.attr(
            label="🔒  Private Isolated Subnets\n(no internet route — VPC endpoints only)",
            style="filled", fillcolor="#E6FAF5",
            color="#148A8A", penwidth="2",
            fontname="Helvetica", fontsize="11", fontcolor="#148A8A",
        )
        priv.node("invoker", **nd("model-invoker λ\n256 MB · 30 s", C["lambda"]))
        priv.node("trainer", **nd("model-trainer λ\n512 MB · 10 min", C["lambda"]))
        priv.node("rds",     **nd("RDS PostgreSQL\nt3.micro", C["rds"]))

    # VPC Endpoints ────────────────────────────────────────────────────────────
    with vpc.subgraph(name="cluster_ep") as ep:
        ep.attr(
            label="VPC Endpoints",
            style="filled", fillcolor="#FFF0FE",
            color="#7c3aed", penwidth="1.5",
            fontname="Helvetica", fontsize="10", fontcolor="#7c3aed",
        )
        ep.node("sm_ep", **nd("Secrets Manager\n(interface endpoint)", C["sm"]))
        ep.node("s3_gw", **nd("S3 Gateway endpoint\n(free)", C["s3"]))

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
dot.edge("cf",      "alb",        label=" /api/*", **E)
dot.edge("cf",      "ws_api",     label=" /ws",    **E)

# WebSocket API GW → api-handler (and price-fetcher pushes back)
dot.edge("ws_api",   "api_handler",           **E)
dot.edge("pf",       "ws_api", label=" push", **E)

# ALB → api-handler
dot.edge("alb", "api_handler", **E)

# Ingestion
dot.edge("eb_fetch", "pf",  **E)
dot.edge("goldapi",   "pf",  **E)
dot.edge("pf",        "rds", **E)

# API handler → private
dot.edge("api_handler", "invoker", label=" invoke", **E)
dot.edge("api_handler", "rds",                      **E)

# ML
dot.edge("eb_train", "trainer",   **E)
dot.edge("invoker",  "rds",       **E)
dot.edge("invoker",  "m_bucket",  **E)
dot.edge("trainer",  "rds",       **E)
dot.edge("trainer",  "m_bucket",  **E)

# VPC endpoints (dashed purple)
for src in ["pf", "api_handler", "invoker", "trainer"]:
    dot.edge(src, "sm_ep", **EP)
for src in ["invoker", "trainer"]:
    dot.edge(src, "s3_gw", **EP)
dot.edge("sm_ep", "sm_rds",   **EP)
dot.edge("sm_ep", "sm_api",   **EP)
dot.edge("s3_gw", "m_bucket", **EP)

# Monitoring (dashed grey, no arrowhead)
for src in ["pf", "api_handler", "invoker", "trainer", "rds"]:
    dot.edge(src, "cw", **MN)
dot.edge("cw", "sns", color=C["cw"], penwidth="1.4", fontname="Helvetica")

dot.render("architecture", cleanup=True)
print("architecture.png written.")
