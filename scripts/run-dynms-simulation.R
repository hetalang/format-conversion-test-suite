args <- commandArgs(trailingOnly = TRUE)

if (length(args) != 7L) {
  stop("Expected arguments: <project-directory> <source-file> <output-csv-path> <simulation-json-path> <log-path> <reference-csv-path> <plot-directory>", call. = FALSE)
}

project_directory <- args[[1]]
source_file <- args[[2]]
output_path <- args[[3]]
simulation_path <- args[[4]]
log_path <- args[[5]]
reference_path <- args[[6]]
plot_directory <- args[[7]]

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("Package `jsonlite` is required to read the simulation configuration.", call. = FALSE)
}
if (!requireNamespace("DynMSR", quietly = TRUE)) {
  stop("Package `DynMSR` is not installed. Install it before running this command.", call. = FALSE)
}

library(DynMSR)

simulation <- jsonlite::fromJSON(simulation_path, simplifyVector = FALSE)
time_course <- simulation$timeCourse
if (is.null(time_course)) {
  stop("The selected case does not define a time course.", call. = FALSE)
}

platform <- heta_load(dir = project_directory, source = source_file, type = "heta", log_path = log_path)
if (length(platform$models) != 1L) {
  stop("DynMS simulation currently requires exactly one model.", call. = FALSE)
}

model <- platform$models[[1]]
requested <- simulation$variables
column_map <- list()

find_symbol <- function(collection, symbol) {
  which(vapply(collection, function(item) {
    identical(item$id, symbol) || identical(item$title, symbol)
  }, logical(1)))
}

select_symbol <- function(collection, symbol, collection_name) {
  index <- find_symbol(collection, symbol)
  if (length(index) == 1L) {
    return(collection[[index]]$id)
  }
  if (length(index) > 1L) {
    stop("DynMS model has multiple ", collection_name, " entries for requested variable: ", symbol, call. = FALSE)
  }
  NULL
}

for (symbol in requested) {
  amount <- symbol %in% simulation$amountVariables
  concentration <- symbol %in% simulation$concentrationVariables
  candidate_collections <- if (amount) {
    list(dynamic = model$dynamic)
  } else if (concentration) {
    list(assignments = model$assignments)
  } else {
    list(assignments = model$assignments, dynamic = model$dynamic, static = model$static, constants = model$constants)
  }
  selected <- NULL
  for (collection_name in names(candidate_collections)) {
    selected <- select_symbol(candidate_collections[[collection_name]], symbol, collection_name)
    if (!is.null(selected)) break
  }
  if (is.null(selected)) stop("DynMS model has no supported symbol for requested variable: ", symbol, call. = FALSE)
  column_map[[symbol]] <- selected
}

compiled <- build_mrgsolve(model, observables = unname(unlist(column_map)), quiet = TRUE)
result <- mrgsolve::mrgsim(
  compiled,
  start = time_course$start,
  end = time_course$start + time_course$duration,
  delta = time_course$duration / time_course$steps,
  atol = simulation$absoluteTolerance,
  rtol = simulation$relativeTolerance
)
data <- methods::slot(result, "data")
output <- data.frame(time = data$time, check.names = FALSE)

for (symbol in requested) {
  source_column <- column_map[[symbol]]
  if (!(source_column %in% names(data))) {
    stop("mrgsolve did not produce a column for requested variable: ", symbol, call. = FALSE)
  }
  output[[symbol]] <- data[[source_column]]
}

write.csv(output, output_path, row.names = FALSE, quote = FALSE)

reference <- read.csv(reference_path, check.names = FALSE)
for (index in seq_along(requested)) {
  symbol <- requested[[index]]
  if (!(symbol %in% names(reference)) || !(symbol %in% names(output))) {
    stop("Unable to plot requested variable: ", symbol, call. = FALSE)
  }
  dir.create(plot_directory, recursive = TRUE, showWarnings = FALSE)
  png(file.path(plot_directory, sprintf("plot-%03d.png", index)), width = 1200, height = 800, res = 150)
  plot(reference$time, reference[[symbol]], type = "l", col = "#1f77b4", lwd = 2,
    xlab = "Time", ylab = symbol, main = symbol)
  lines(output$time, output[[symbol]], col = "#d62728", lwd = 2, lty = 2)
  legend("topright", legend = c("Reference", "DynMSR/mrgsolve"), col = c("#1f77b4", "#d62728"), lwd = 2, lty = c(1, 2), bty = "n")
  dev.off()
}
