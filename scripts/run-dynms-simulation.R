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
requested <- unname(unlist(simulation$variables, use.names = FALSE))
species_outputs <- simulation$speciesOutputs
if (is.null(species_outputs)) {
  stop("Simulation settings must include species output metadata for the selected SBML version.", call. = FALSE)
}

converted_species <- names(species_outputs)[vapply(species_outputs, function(species) {
  species$modelValue != species$referenceValue
}, logical(1))]
compartments <- vapply(species_outputs[converted_species], function(species) {
  species$compartment
}, character(1))
observables <- unique(c(requested, compartments))

compiled <- build_mrgsolve(
  model,
  observables = observables,
  quiet = TRUE
)
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
  if (!(symbol %in% names(data))) {
    stop("mrgsolve did not produce a column for requested variable: ", symbol, call. = FALSE)
  }
  value <- data[[symbol]]
  species <- species_outputs[[symbol]]
  if (!is.null(species) && species$modelValue != species$referenceValue) {
    compartment <- species$compartment
    if (!(compartment %in% names(data))) {
      stop("mrgsolve did not produce a column for compartment: ", compartment, call. = FALSE)
    }
    size <- data[[compartment]]
    value <- if (species$modelValue == "amount") value / size else value * size
  }
  output[[symbol]] <- value
}

write.csv(output, output_path, row.names = FALSE, quote = FALSE)

reference <- read.csv(reference_path, check.names = FALSE)
reference_time_columns <- names(reference)[tolower(names(reference)) == "time"]
if (length(reference_time_columns) != 1L) {
  stop("Reference CSV must contain exactly one time column.", call. = FALSE)
}
reference_time <- reference[[reference_time_columns[[1]]]]

write_plot <- function(index, symbol) {
  tryCatch({
    png(file.path(plot_directory, sprintf("plot-%03d.png", index)), width = 1200, height = 800, res = 150)
    on.exit(dev.off(), add = TRUE)
    plot(reference_time, reference[[symbol]], type = "l", col = "#1f77b4", lwd = 2,
      xlab = "Time", ylab = symbol, main = symbol)
    lines(output$time, output[[symbol]], col = "#d62728", lwd = 2, lty = 2)
    legend("topright", legend = c("Reference", "DynMSR/mrgsolve"), col = c("#1f77b4", "#d62728"), lwd = 2, lty = c(1, 2), bty = "n")
  }, error = function(error) {
    warning("Unable to generate plot for ", symbol, ": ", conditionMessage(error), call. = FALSE)
  })
}

for (index in seq_along(requested)) {
  symbol <- requested[[index]]
  if (!(symbol %in% names(reference)) || !(symbol %in% names(output))) {
    warning("Unable to generate plot for missing requested variable: ", symbol, call. = FALSE)
    next
  }
  dir.create(plot_directory, recursive = TRUE, showWarnings = FALSE)
  write_plot(index, symbol)
}
