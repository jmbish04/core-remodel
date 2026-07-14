export interface DiagramTemplate {
  id: string
  name: string
  category: string
  chart: string
}

export const diagramTemplates: DiagramTemplate[] = [
  {
    id: "sequence-basic",
    name: "API Request",
    category: "Sequence",
    chart: `sequenceDiagram
    participant C as Client
    participant S as Server
    participant DB as Database

    C->>S: POST /api/users
    S->>S: Validate Input
    S->>DB: INSERT user
    DB-->>S: User created
    S-->>C: 201 Created`,
  },
  {
    id: "flowchart-basic",
    name: "Basic Flowchart",
    category: "Flowchart",
    chart: `flowchart TD
    A([Start]) --> B[Process Data]
    B --> C[Validate]
    C -->|Pass| D[Save to DB]
    C -->|Fail| E[Log Error]
    E --> B
    D --> F([Complete])`,
  },
  {
    id: "flowchart-complex",
    name: "CI/CD Pipeline",
    category: "Flowchart",
    chart: `flowchart LR
    A([Push Code]) --> B[Build]
    B --> C[Run Tests]
    C -->|Pass| D[Stage Deploy]
    C -->|Fail| E[Notify Dev]
    E --> A
    D --> F[Code Review]
    F -->|Approved| G[Production]
    F -->|Rejected| E
    G --> H([Monitor])`,
  },
  {
    id: "sequence-auth",
    name: "OAuth Flow",
    category: "Sequence",
    chart: `sequenceDiagram
    participant U as User
    participant A as App
    participant P as Provider
    participant API as API Server

    U->>A: Click Login
    A->>P: Redirect to OAuth
    P->>U: Show Login Form
    U->>P: Enter Credentials
    P->>A: Auth Code
    A->>P: Exchange Code
    P-->>A: Access Token
    A->>API: Request with Token
    API-->>A: Protected Data`,
  },
  {
    id: "class-diagram",
    name: "Class Diagram",
    category: "Class",
    chart: `classDiagram
    class User {
        +String name
        +String email
        +login()
        +logout()
    }
    class Post {
        +String title
        +String content
        +publish()
    }
    class Comment {
        +String body
        +Date createdAt
        +edit()
    }
    User "1" --> "*" Post : writes
    Post "1" --> "*" Comment : has
    User "1" --> "*" Comment : makes`,
  },
  {
    id: "state-diagram",
    name: "Order State",
    category: "State",
    chart: `stateDiagram-v2
    [*] --> Pending
    Pending --> Processing : Payment received
    Processing --> Shipped : Items packed
    Shipped --> Delivered : Arrived
    Delivered --> [*]
    Processing --> Cancelled : Cancel request
    Pending --> Cancelled : Cancel request
    Cancelled --> [*]`,
  },
  {
    id: "er-diagram",
    name: "E-Commerce ER",
    category: "Entity",
    chart: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "ordered in"
    CUSTOMER {
        int id PK
        string name
        string email
    }
    ORDER {
        int id PK
        date created
        string status
    }
    PRODUCT {
        int id PK
        string name
        float price
    }
    LINE_ITEM {
        int quantity
        float subtotal
    }`,
  },
  {
    id: "gantt-chart",
    name: "Project Timeline",
    category: "Gantt",
    chart: `gantt
    title Project Launch Timeline
    dateFormat  YYYY-MM-DD
    section Planning
    Requirements     :a1, 2025-01-01, 14d
    Design           :a2, after a1, 10d
    section Development
    Frontend         :b1, after a2, 21d
    Backend          :b2, after a2, 21d
    Integration      :b3, after b1, 7d
    section Launch
    Testing          :c1, after b3, 10d
    Deployment       :c2, after c1, 3d`,
  },
  {
    id: "pie-chart",
    name: "Tech Stack Usage",
    category: "Pie",
    chart: `pie title Technology Distribution
    "React" : 35
    "Next.js" : 25
    "Vue" : 15
    "Svelte" : 10
    "Angular" : 10
    "Other" : 5`,
  },
  {
    id: "gitgraph",
    name: "Git Branching",
    category: "Git",
    chart: `gitGraph
    commit
    commit
    branch develop
    checkout develop
    commit
    commit
    branch feature
    checkout feature
    commit
    commit
    checkout develop
    merge feature
    checkout main
    merge develop
    commit`,
  },
]

export const diagramCategories = [
  ...new Set(diagramTemplates.map((t) => t.category)),
]
