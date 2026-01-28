# Data Flow Diagrams

## 1. High-Level Worker Architecture
This diagram shows the Redis-based worker architecture and flow.

```mermaid
graph TD
    subgraph API
        TS_API[TypeScript API]
    end
    
    subgraph Queue
        Redis[(Redis Queue<br/>jobs:report)]
        Status[(Job Status<br/>job:jobId)]
    end
    
    subgraph Worker
        Worker_Loop[Worker Loop<br/>worker.py]
        Processor[Readiness Processor<br/>readiness_processor.py]
        Detector[Data Type Detector]
    end
    
    subgraph Storage
        S3_Input[(S3/MinIO<br/>Input Bucket)]
        S3_Reports[(S3/MinIO<br/>Reports Bucket)]
    end
    
    subgraph Framework
        S_Main[Structured Main]
        U_Main[Unstructured Main]
    end
    
    TS_API -->|Create Job| Redis
    Worker_Loop -->|Poll Queue| Redis
    Worker_Loop -->|Update Status| Status
    Worker_Loop --> Processor
    Processor -->|Download| S3_Input
    Processor --> Detector
    Detector -->|Structured| S_Main
    Detector -->|Unstructured| U_Main
    S_Main -->|Generate Reports| Processor
    U_Main -->|Generate Reports| Processor
    Processor -->|Upload PDF| S3_Reports
    Processor -->|Update Status| Status
```

## 2. Worker Processing Flow
Detailed flow of how the worker processes a job.

```mermaid
graph TD
    Start([Job Received from Queue]) --> Parse[Parse Job Data<br/>jobId, databankId]
    Parse --> Update1[Update Status: processing]
    Update1 --> Download[Download Files from S3<br/>readiness_processor.py]
    Download --> Extract[Extract Zip Files if Any]
    Extract --> Detect[Detect Data Type<br/>structured/unstructured]
    
    Detect -->|Structured| S_Main[Run structured_main.py]
    Detect -->|Unstructured| U_Main[Run unstructured_main.py]
    
    S_Main --> Reports[Reports Generated<br/>JSON + PDF]
    U_Main --> Reports
    
    Reports --> Upload[Upload PDF to S3<br/>dataReadiness/databankId.pdf]
    Upload --> Update2[Update Status: completed]
    Update2 --> End([Job Complete])
    
    style Start fill:#e1f5ff
    style End fill:#d4edda
```

## 3. Structured Data Framework Flow
Detailed flow within the Structured Data assessment framework.

```mermaid
graph TD
    Start([structured_main.py]) --> Load[Load Data: input_handler]
    Load --> Infer[Infer Column Roles: llm_api]
    Infer --> Raw[Generate Raw Report: aggregate_structured]
    
    subgraph Metrics Calculation
        Raw --> M1[quality.py<br/>Missing/Duplicates]
        Raw --> M2[variance_correctness.py<br/>Variance/Coverage]
        Raw --> M3[standardization.py<br/>Formats/Encoding]
        Raw --> M4[documentation.py<br/>Documentation Presence]
        Raw --> M5[relevance_completeness.py<br/>Region Coverage]
    end

    M1 --> Score[scoring_structured.py<br/>Compute Aggregate Score]
    M2 --> Score
    M3 --> Score
    M4 --> Score
    M5 --> Score
    
    Score --> Write[json_writer.py<br/>Write JSON Reports]
    Write --> PDF[pdf_writer.py<br/>Generate PDF]
    PDF --> End([End])
```

## 4. Unstructured Data Framework Flow
Detailed flow within the Unstructured Data assessment framework.

```mermaid
graph TD
    Start([unstructured_main.py]) --> Meta[metadata_parser.py<br/>Extract Metadata]
    Meta --> Infer[llm_api.py<br/>Infer Roles]
    Infer --> Raw[aggregate_unstructured.py<br/>Generate Raw Report]

    subgraph Metrics Calculation
        Raw --> M1[file_duplicates.py<br/>Check Duplicates]
        Raw --> M2[file_format_check.py<br/>Validate Formats]
        Raw --> M3[file_openability.py<br/>Test Openability]
        Raw --> M4[file_type_consistency.py<br/>Check Consistency]
        Raw --> M5[documentation.py<br/>Documentation Presence]
        Raw --> M6[coverage.py<br/>Metadata Coverage]
    end

    M1 --> Score[scoring_unstructured.py<br/>Compute Aggregate Score]
    M2 --> Score
    M3 --> Score
    M4 --> Score
    M5 --> Score
    M6 --> Score

    Score --> Write[json_writer.py<br/>Write JSON Reports]
    Write --> PDF[pdf_writer.py<br/>Generate PDF]
    PDF --> End([End])
```
